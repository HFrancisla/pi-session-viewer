import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSessionTitle, parseSessionJsonl } from '../core/session-parser'
import type { SessionFileResponse, SessionListItem, SessionListResponse } from '../core/types'

const SESSION_PREFIX_LIMIT = 256 * 1024

function expandHome(value: string): string {
  return value === '~' || value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value
}

export function configuredSessionRootSync(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_CODING_AGENT_SESSION_DIR) {
    return path.resolve(expandHome(env.PI_CODING_AGENT_SESSION_DIR))
  }
  try {
    const settingsPath = path.join(os.homedir(), '.pi', 'agent', 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { sessionDir?: unknown }
    if (typeof settings.sessionDir === 'string' && settings.sessionDir.trim()) {
      return path.resolve(expandHome(settings.sessionDir))
    }
  } catch {
    // Missing or malformed settings fall back to Pi's default location.
  }
  return path.join(os.homedir(), '.pi', 'agent', 'sessions')
}

export async function configuredSessionRoot(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return configuredSessionRootSync(env)
}

export function encodeSessionToken(relativePath: string): string {
  return Buffer.from(relativePath, 'utf8').toString('base64url')
}

export function decodeSessionToken(token: string): string {
  return Buffer.from(token, 'base64url').toString('utf8')
}

function isSessionCandidate(entry: import('node:fs').Dirent, name: string): boolean {
  return entry.isFile()
    && name.endsWith('.jsonl')
    && name !== 'events.jsonl'
    && !name.endsWith('_transcript.jsonl')
}

async function walkJsonl(root: string): Promise<string[]> {
  const files: string[] = []
  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'subagent-artifacts') continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute)
      } else if (isSessionCandidate(entry, entry.name)) {
        files.push(absolute)
      }
    }
  }
  await visit(root)
  return files
}

async function readPrefix(filePath: string, limit = SESSION_PREFIX_LIMIT): Promise<string> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await handle.read(buffer, 0, limit, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function sessionMetadata(root: string, filePath: string): Promise<SessionListItem | null> {
  const prefix = await readPrefix(filePath)
  const firstLine = prefix.split(/\r?\n/, 1)[0]
  try {
    const header = JSON.parse(firstLine) as Record<string, unknown>
    if (header.type !== 'session') return null
    const relativePath = path.relative(root, filePath)
    const parsed = parseSessionJsonl(prefix, path.basename(filePath))
    const stat = await fs.stat(filePath)
    return {
      token: encodeSessionToken(relativePath),
      id: typeof header.id === 'string' ? header.id : relativePath,
      title: getSessionTitle(parsed),
      cwd: typeof header.cwd === 'string' ? header.cwd : 'Unknown working directory',
      timestamp: typeof header.timestamp === 'string' ? header.timestamp : undefined,
      modifiedAt: stat.mtime.toISOString(),
      relativePath,
      parentSession: typeof header.parentSession === 'string' ? header.parentSession : undefined,
    }
  } catch {
    return null
  }
}

export async function listSessions(root: string, currentCwd?: string): Promise<SessionListResponse> {
  const warnings: string[] = []
  try {
    const rootRealPath = await fs.realpath(root)
    const files = await walkJsonl(rootRealPath)
    const sessions: SessionListItem[] = []
    for (let index = 0; index < files.length; index += 32) {
      const batch = await Promise.all(files.slice(index, index + 32).map(async (filePath) => {
        try {
          return await sessionMetadata(rootRealPath, filePath)
        } catch {
          warnings.push(`Failed to read ${path.relative(rootRealPath, filePath)}`)
          return null
        }
      }))
      sessions.push(...batch.filter((item): item is SessionListItem => item !== null))
    }
    sessions.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    return { root: rootRealPath, currentCwd, sessions, warnings }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { root, currentCwd, sessions: [], warnings: [`Failed to scan Pi session directory: ${message}`] }
  }
}

export async function resolveAllowedSessionFile(root: string, token: string): Promise<{ absolute: string; relative: string }> {
  const rootRealPath = await fs.realpath(root)
  const relative = decodeSessionToken(token)
  if (!relative || !relative.endsWith('.jsonl') || path.isAbsolute(relative)) {
    throw new Error('Invalid session file identifier.')
  }
  const candidate = path.resolve(rootRealPath, relative)
  const absolute = await fs.realpath(candidate)
  if (absolute !== rootRealPath && !absolute.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error('Requested file is outside allowed directory.')
  }
  const name = path.basename(absolute)
  if (name === 'events.jsonl' || name.endsWith('_transcript.jsonl') || absolute.split(path.sep).includes('subagent-artifacts')) {
    throw new Error('Reading this session file is not permitted.')
  }
  const stat = await fs.stat(absolute)
  if (!stat.isFile()) throw new Error('Requested session file is invalid.')
  return { absolute, relative: path.relative(rootRealPath, absolute) }
}

export async function readSessionFile(root: string, token: string): Promise<SessionFileResponse> {
  const { absolute, relative } = await resolveAllowedSessionFile(root, token)
  const [content, stat] = await Promise.all([fs.readFile(absolute, 'utf8'), fs.stat(absolute)])
  return { token, relativePath: relative, modifiedAt: stat.mtime.toISOString(), content }
}
