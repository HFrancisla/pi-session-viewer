import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { piSessionHeader } from './helpers/pi-session'

const execFileAsync = promisify(execFile)
const directories: string[] = []

afterEach(async () => {
  while (directories.length) await rm(directories.pop() as string, { recursive: true, force: true })
})

describe('real-session checker', () => {
  it('parses the listed Session Catalog while scanning prompts from excluded files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-real-session-check-'))
    directories.push(root)
    const fixture = JSON.parse(await readFile('tests/fixtures/prompts/current-vanilla.json', 'utf8')) as {
      options: Record<string, unknown>
      prompt: string
    }
    const timestamp = '2026-01-01T10:00:00.000Z'
    const capturedPrompt = (id: string) => JSON.stringify({
      type: 'custom',
      id,
      parentId: null,
      timestamp,
      customType: 'pi-session-viewer.system-prompt',
      data: { prompt: fixture.prompt, composition: fixture.options },
    })
    const putSession = async (relativePath: string, id: string, extra: Record<string, unknown> = {}) => {
      const file = path.join(root, relativePath)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, `${piSessionHeader(id, timestamp, root, extra)}\n${capturedPrompt(`prompt-${id}`)}\n`)
    }

    await putSession('standalone.jsonl', 'standalone')
    await putSession('subagent-artifacts/child.jsonl', 'path-child', { parentSession: 'standalone' })
    await putSession('known-child.jsonl', 'subagent-known-child')

    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', path.resolve('scripts/check-real-sessions.ts')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PI_CODING_AGENT_SESSION_DIR: root,
          PI_SESSION_SCAN_LIMIT: '20',
        },
        maxBuffer: 1024 * 1024,
      },
    )

    expect(stdout).toContain('Scanned 3 session files under')
    expect(stdout).toContain('Parsed 1 sessions (0 without a header); 3 captured system prompts')
    expect(stdout).toContain('OK: every captured prompt was fully explained by the parser.')
  })
})
