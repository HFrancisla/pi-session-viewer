import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSessionTitle, parseSessionJsonl } from '../core/session-parser'
import { subagentTargetCandidates } from '../core/subagent-detector'
import type {
  ProjectSummary,
  SessionFileResponse,
  SessionListItem,
  SessionListResponse,
} from '../core/types'
import { createLruCache } from '../core/lru-cache'
import { normalizePath } from '../core/path'

const SUBAGENT_DIRECTORY_NAMES = new Set(['subagent-artifacts', 'subagents'])
// Pi run IDs are UUIDs; target paths also use short hex and run-<number> IDs.
const RUN_IDENTIFIER = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{4,}|run-\d+)$/i
const RUN_DIRECTORY = /^run-\d+$/

function sessionPathSegments(relativePath: string): string[] {
  return relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
}

function isSubagentPathSegment(segment: string): boolean {
  return SUBAGENT_DIRECTORY_NAMES.has(segment)
}

function hasSubagentPathSegment(segments: string[]): boolean {
  return segments.some(isSubagentPathSegment)
}

function isSessionCatalogSubtreeExcluded(relativePath: string): boolean {
  return hasSubagentPathSegment(sessionPathSegments(relativePath))
}

function isRunnableSubagentSession(segments: string[]): boolean {
  const runIdentifier = segments.at(-3)
  return Boolean(runIdentifier && RUN_IDENTIFIER.test(runIdentifier))
    && segments.at(-1) === 'session.jsonl'
    && RUN_DIRECTORY.test(segments.at(-2) ?? '')
}

function isSessionCatalogPathMember(relativePath: string): boolean {
  const segments = sessionPathSegments(relativePath)
  if (hasSubagentPathSegment(segments)) return false
  if (segments.at(-1)?.endsWith('_transcript.jsonl')) return false
  return !isRunnableSubagentSession(segments)
}

function isSessionCatalogMember(session: SessionListItem): boolean {
  if (session.parentSession?.trim()) return false
  if (session.id.toLowerCase().startsWith('subagent-')) return false
  return isSessionCatalogPathMember(session.relativePath)
}

export function projectName(cwd: string): string {
  if (!cwd || cwd === 'Unknown working directory') return 'Unknown Project'
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? cwd
}

/**
 * Disambiguates duplicate project directory basenames by prepending the minimum
 * number of parent directory segments required to make each label unique.
 */
export function disambiguateProjectNames(cwds: string[]): Map<string, string> {
  const result = new Map<string, string>()
  const parsed = cwds.map((cwd) => {
    const norm = normalizePath(cwd)
    const segments = norm.split('/').filter(Boolean)
    return { cwd, norm, segments }
  })

  for (const item of parsed) {
    if (!item.norm || item.norm === 'Unknown working directory') {
      result.set(item.norm, 'Unknown Project')
      continue
    }
    let depth = 1
    while (depth <= item.segments.length) {
      const candidate = item.segments.slice(-depth).join('/')
      const collision = parsed.some((other) => {
        if (other.norm === item.norm) return false
        const otherCandidate = other.segments.slice(-depth).join('/')
        return otherCandidate === candidate
      })
      if (!collision || depth === item.segments.length) {
        result.set(item.norm, candidate)
        break
      }
      depth += 1
    }
  }
  return result
}

export function buildProjectSummaries(sessions: SessionListItem[]): {
  projects: ProjectSummary[]
  projectNames: Map<string, string>
} {
  const map = new Map<string, { cwd: string; count: number; latestModifiedAt: string }>()
  for (const session of sessions) {
    const key = normalizePath(session.cwd) || 'Unknown working directory'
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        cwd: session.cwd,
        count: 1,
        latestModifiedAt: session.modifiedAt,
      })
    } else {
      existing.count += 1
      if (session.modifiedAt.localeCompare(existing.latestModifiedAt) > 0) {
        existing.latestModifiedAt = session.modifiedAt
      }
    }
  }

  const distinctCwds = Array.from(map.values()).map((item) => item.cwd)
  const disambiguatedNames = disambiguateProjectNames(distinctCwds)

  const projects = Array.from(map.values())
    .map((item) => ({
      ...item,
      name: disambiguatedNames.get(normalizePath(item.cwd)) ?? projectName(item.cwd),
    }))
    .sort((a, b) => b.latestModifiedAt.localeCompare(a.latestModifiedAt))

  return { projects, projectNames: disambiguatedNames }
}

const SESSION_PREFIX_LIMIT = 256 * 1024

/**
 * Catalog rows survive a rescan as long as the file's identity is unchanged.
 * The scan is the most expensive thing the viewer does (every session's prefix is
 * parsed), and it runs inside the Pi process, so a refresh must not repeat it.
 */
const metadataCache = createLruCache<SessionListItem | null>({ maxEntries: 4096 })

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

import { decodeSessionToken, encodeSessionToken } from '../core/session-token'
export { decodeSessionToken, encodeSessionToken }

function isSessionCandidate(entry: import('node:fs').Dirent, name: string): boolean {
  return entry.isFile()
    && name.endsWith('.jsonl')
    && name !== 'events.jsonl'
}

async function walkSessionCandidates(root: string): Promise<string[]> {
  const files: string[] = []
  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (isSessionCatalogSubtreeExcluded(path.relative(root, absolute))) continue
        await visit(absolute)
      } else if (
        isSessionCandidate(entry, entry.name)
        && isSessionCatalogPathMember(path.relative(root, absolute))
      ) {
        files.push(absolute)
      }
    }
  }
  await visit(root)
  return files
}

/** Returns the absolute paths of the Sessions admitted by the server catalog. */
export async function walkSessionFiles(root: string): Promise<string[]> {
  const catalog = await listSessions(root)
  return catalog.sessions.map((session) => path.resolve(catalog.root, session.relativePath))
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
  // Stat first: the cache key is the file's identity, so an unchanged file costs
  // one syscall instead of a 256 KB read and parse.
  const stat = await fs.stat(filePath)
  const cacheKey = `${filePath}\u0000${stat.mtimeMs}\u0000${stat.size}`
  const cached = metadataCache.get(cacheKey)
  if (cached !== undefined) return cached
  const item = await readSessionMetadata(root, filePath, stat)
  metadataCache.set(cacheKey, item)
  return item
}

async function readSessionMetadata(
  root: string,
  filePath: string,
  stat: import('node:fs').Stats,
): Promise<SessionListItem | null> {
  const prefix = await readPrefix(filePath)
  const firstLine = prefix.split(/\r?\n/, 1)[0]
  try {
    const header = JSON.parse(firstLine) as unknown
    if (!isValidPiSessionHeader(header)) return null
    const relativePath = path.relative(root, filePath)
    const item: SessionListItem = {
      token: encodeSessionToken(relativePath),
      id: header.id,
      title: '',
      cwd: header.cwd,
      timestamp: header.timestamp,
      modifiedAt: stat.mtime.toISOString(),
      relativePath,
      parentSession: header.parentSession,
    }
    if (!isSessionCatalogMember(item)) return null

    const parsed = parseSessionJsonl(prefix, path.basename(filePath))
    return { ...item, title: getSessionTitle(parsed) }
  } catch {
    return null
  }
}

function isValidPiSessionHeader(value: unknown): value is {
  type: 'session'
  id: string
  timestamp: string
  cwd: string
  parentSession?: string
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const header = value as Record<string, unknown>
  return header.type === 'session'
    && typeof header.id === 'string'
    && header.id.trim().length > 0
    && typeof header.timestamp === 'string'
    && header.timestamp.trim().length > 0
    && typeof header.cwd === 'string'
    && (header.version === undefined || typeof header.version === 'number')
    && (header.parentSession === undefined || typeof header.parentSession === 'string')
}

export async function discoverSessionCatalog(root: string, currentCwd?: string): Promise<SessionListResponse> {
  const warnings: string[] = []
  try {
    const rootRealPath = await fs.realpath(root)
    const files = await walkSessionCandidates(rootRealPath)
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
      // The scan runs inside the Pi process: yield between batches so the TUI's
      // event loop keeps breathing while a large session directory is walked.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    sessions.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))

    const { projects, projectNames } = buildProjectSummaries(sessions)
    for (const session of sessions) {
      session.projectName = projectNames.get(normalizePath(session.cwd)) ?? projectName(session.cwd)
    }

    let initialSessionToken: string | undefined
    if (currentCwd) {
      const normTarget = normalizePath(currentCwd)
      const matched = sessions.find((s) => normalizePath(s.cwd) === normTarget)
      initialSessionToken = matched?.token ?? sessions[0]?.token
    } else {
      initialSessionToken = sessions[0]?.token
    }

    return { root: rootRealPath, currentCwd, projects, sessions, initialSessionToken, warnings }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { root, currentCwd, projects: [], sessions: [], warnings: [`Failed to scan Pi session directory: ${message}`] }
  }
}

export const listSessions = discoverSessionCatalog

export async function resolveAllowedSessionPath(root: string, relative: string): Promise<{ absolute: string; relative: string }> {
  const rootRealPath = await fs.realpath(root)
  if (!relative || !relative.endsWith('.jsonl') || path.isAbsolute(relative)) {
    throw new Error('Invalid session file identifier.')
  }
  const candidate = path.resolve(rootRealPath, relative)
  const absolute = await fs.realpath(candidate)
  if (absolute !== rootRealPath && !absolute.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error('Requested file is outside allowed directory.')
  }
  const name = path.basename(absolute)
  // Sidecar event logs are not session files. Subagent transcripts are readable:
  // pi-subagents reports them as the result of a subagent tool call, so refusing
  // them left the viewer's subagent navigation broken (the catalog still hides
  // them from the session list).
  if (name === 'events.jsonl') {
    throw new Error('Reading this session file is not permitted.')
  }
  const stat = await fs.stat(absolute)
  if (!stat.isFile()) throw new Error('Requested session file is invalid.')
  return { absolute, relative: path.relative(rootRealPath, absolute) }
}

export async function resolveAllowedSessionFile(root: string, token: string): Promise<{ absolute: string; relative: string }> {
  const relative = decodeSessionToken(token)
  return resolveAllowedSessionPath(root, relative)
}

export type ResolveSessionTargetResult =
  | { kind: 'resolved'; absolute: string; relative: string; token: string }
  | { kind: 'transcript-only' }
  | { kind: 'not-found' }

export async function resolveSessionTarget(
  root: string,
  targetFile: string,
  parentRelative?: string,
): Promise<ResolveSessionTargetResult> {
  const candidates = subagentTargetCandidates(targetFile, parentRelative)
  let sawTranscriptOnly = false

  for (const candidate of candidates) {
    let resolved: { absolute: string; relative: string }
    try {
      resolved = await resolveAllowedSessionPath(root, candidate)
    } catch {
      continue
    }

    try {
      const prefix = await readPrefix(resolved.absolute, 4096)
      const firstLine = prefix.split(/\r?\n/, 1)[0]
      const header = JSON.parse(firstLine)
      if (isValidPiSessionHeader(header)) {
        return {
          kind: 'resolved',
          absolute: resolved.absolute,
          relative: resolved.relative,
          token: encodeSessionToken(resolved.relative),
        }
      }
      sawTranscriptOnly = true
    } catch {
      sawTranscriptOnly = true
    }
  }

  if (sawTranscriptOnly) {
    return { kind: 'transcript-only' }
  }
  return { kind: 'not-found' }
}

export async function readSessionFile(root: string, token: string): Promise<SessionFileResponse> {
  const { absolute, relative } = await resolveAllowedSessionFile(root, token)
  const [content, stat] = await Promise.all([fs.readFile(absolute, 'utf8'), fs.stat(absolute)])
  return { token, relativePath: relative, modifiedAt: stat.mtime.toISOString(), content }
}
