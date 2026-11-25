import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { piSessionHeader } from './helpers/pi-session'
import { PI_VERSION } from './helpers/pi-runtime'

const execFileAsync = promisify(execFile)
const directories: string[] = []

afterEach(async () => {
  while (directories.length) await rm(directories.pop() as string, { recursive: true, force: true })
})

describe('real-session checker', () => {
  it('识别带空白格式的上下文编辑记录并正确统计', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', path.resolve('scripts/check-real-sessions.ts')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PI_CODING_AGENT_SESSION_DIR: path.resolve('tests/fixtures/sessions'),
          PI_SESSION_SCAN_LIMIT: '20',
        },
        maxBuffer: 1024 * 1024,
      },
    )

    expect(stdout).toContain('1 contain context edits')
    expect(stdout).toContain('1 entries omitted by a context edit')
  })

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
      data: { prompt: fixture.prompt, composition: fixture.options, piVersion: PI_VERSION },
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
    expect(stdout).toContain('OK: every supported captured prompt was fully explained by the parser.')
  })

  it('ignores every unsupported version but strictly validates current captures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pi-viewer-prompt-layout-'))
    directories.push(root)
    const file = path.join(root, 'session.jsonl')
    const timestamp = '2026-01-01T10:00:00.000Z'
    const raw = '  Available tools:\n- bash: Execute commands\n\nGuidelines:\n- Use tests first\n '
    const forced = 'Forced content.\n\n<tools>\nLiteral example\n</tools>'
    const capture = (id: string, data: Record<string, unknown>) => JSON.stringify({
      type: 'custom', id, parentId: null, timestamp, customType: 'pi-session-viewer.system-prompt', data,
    })
    const header = piSessionHeader('session', timestamp, root)
    const records = [header, capture('old', { prompt: raw }), capture('legacy', { prompt: '<unexpected>\nBody\n</unexpected>', piVersion: '1.5.0' }),
      capture('future', { prompt: raw, piVersion: '999.0.0' }), capture('old-ref', { recordType: 'reference', promptHash: 'old' }), capture('forced', {
      prompt: forced, piVersion: PI_VERSION, composition: { forceSystemPrompt: forced },
    })]
    const run = () => execFileAsync(process.execPath, ['--import', 'tsx', path.resolve('scripts/check-real-sessions.ts')], {
      cwd: process.cwd(), env: { ...process.env, PI_CODING_AGENT_SESSION_DIR: root }, maxBuffer: 1024 * 1024,
    })
    await writeFile(file, records.join('\n') + '\n')
    const { stdout } = await run()
    expect(stdout).not.toContain('unknown=')
    expect(stdout).toContain('opaque=1')
    expect(stdout).toContain('Ignored unsupported captures: 3 snapshots, 1 references')
    expect(stdout).toContain('every supported captured prompt was fully explained')

    await writeFile(file, records.slice(0, -1).join('\n') + '\n')
    const empty = await run()
    expect(empty.stdout).toContain('No supported prompt snapshots found')
    expect(empty.stdout).toContain('Layouts: none')

    await writeFile(file, [...records, capture('regression', { prompt: raw, piVersion: PI_VERSION }),
      capture('unknown-section', { prompt: '<unexpected>\nBody\n</unexpected>', piVersion: PI_VERSION })].join('\n') + '\n')
    await expect(run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('unknown layout: 1') })
    await expect(run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('unknown Pi sections (unexpected): 1') })
  })

})
