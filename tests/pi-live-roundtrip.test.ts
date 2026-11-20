import { spawn, execFileSync } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { readFile, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { parseSessionJsonl } from '../src/core/session-parser'
import { buildSessionView } from '../src/core/session-view'
import { PI_PACKAGE_DIR, PI_VERSION } from './helpers/pi-runtime'

interface RpcRecord {
  type: string
  id?: string
  command?: string
  success?: boolean
  error?: string
  data?: { disposition?: string; cancelled?: boolean; commands?: Array<{ name: string }> }
}

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

function completionChunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return JSON.stringify({
    id: 'chatcmpl-viewer-audit',
    object: 'chat.completion.chunk',
    created: 1760000000,
    model: 'audit-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })
}

/**
 * Real Pi CLI + real extension hooks + a local fake OpenAI-compatible provider.
 * There are no live provider credentials or external API calls. The fake provider
 * requests bash once, receives the actual tool result, then answers two user turns.
 */
it('captures prompts, multi-turn messages and tool round trips from the installed Pi', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-viewer-live-'))
  const sessionDirectory = path.join(directory, 'sessions')
  const requests: Array<{ model?: string; messages?: Array<{ role?: string; content?: unknown }>; tools?: unknown[] }> = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }

    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const requestIndex = requests.length

      // First request asks Pi to execute a harmless local bash command.
      const delta = requestIndex === 1
        ? {
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call_viewer_audit',
              type: 'function',
              function: { name: 'bash', arguments: '{"command":"printf viewer_tool_ok"}' },
            }],
          }
        : {
            role: 'assistant',
            content: requestIndex === 2 ? 'First turn complete.'
              : requestIndex === 3 ? 'Second turn complete.'
              : requestIndex === 4 ? 'Third turn complete.'
              : 'Fourth turn complete.',
          }

      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.write(`data: ${completionChunk(delta)}\n\n`)
      response.write(`data: ${completionChunk({}, requestIndex === 1 ? 'tool_calls' : 'stop')}\n\n`)
      response.end('data: [DONE]\n\n')
    } catch {
      response.writeHead(500).end()
    }
  })

  let child: ReturnType<typeof spawn> | undefined
  try {
    await mkdir(sessionDirectory)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as AddressInfo).port

    const providerExtension = path.join(directory, 'provider.mjs')
    await writeFile(providerExtension, `
export default function(pi) {
  pi.registerProvider('viewer-test', {
    name: 'Viewer Test', baseUrl: process.env.PI_VIEWER_TEST_BASE_URL,
    apiKey: 'local', api: 'openai-completions',
    models: [{ id: 'audit-model', name: 'Audit Model', reasoning: false,
      input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000, maxTokens: 2048 }],
  });
}
`)

    // The actual Pi CLI only accepts compiled extensions; keep the check
    // self-contained even when CI runs unit tests before the build job.
    execFileSync(process.execPath, ['scripts/build-extension.mjs'], { cwd: projectRoot })
    const cli = path.join(PI_PACKAGE_DIR, 'dist/bundle/cli.js')
    const extension = path.join(projectRoot, 'dist/extension/index.js')
    child = spawn(process.execPath, [
      cli, '--mode', 'rpc', '--no-extensions',
      '-e', extension, '-e', providerExtension,
      '--session-dir', sessionDirectory, '--no-mcp',
      '--no-skills', '--no-context-files', '--offline',
      '--provider', 'viewer-test', '--model', 'audit-model',
    ], {
      cwd: directory,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: path.join(directory, 'config'),
        PI_VIEWER_TEST_BASE_URL: `http://127.0.0.1:${port}/v1`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const records = new EventEmitter()
    const lines = createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      try { records.emit('record', JSON.parse(line) as RpcRecord) } catch { /* ignore non-JSON diagnostics */ }
    })

    async function submitTurn(id: string, message: string): Promise<void> {
      const settled = new Promise<RpcRecord>((resolve, reject) => {
        const timeout = setTimeout(() => {
          records.off('record', onRecord)
          reject(new Error(`Pi did not settle turn ${id}`))
        }, 20_000)
        const onRecord = (record: RpcRecord) => {
          if (record.type === 'agent_settled') {
            clearTimeout(timeout)
            records.off('record', onRecord)
            resolve(record)
          } else if (record.type === 'extension_error' || (record.type === 'response' && record.id === id && !record.success)) {
            clearTimeout(timeout)
            records.off('record', onRecord)
            reject(new Error(JSON.stringify(record)))
          }
        }
        records.on('record', onRecord)
      })
      child!.stdin!.write(JSON.stringify({ id, type: 'prompt', message }) + '\n')
      await settled
    }

    async function submitCommand(id: string, type: string, extra: Record<string, unknown> = {}): Promise<RpcRecord> {
      const result = new Promise<RpcRecord>((resolve, reject) => {
        const timeout = setTimeout(() => {
          records.off('record', onRecord)
          reject(new Error(`Pi did not answer command ${id}`))
        }, 10_000)
        const onRecord = (record: RpcRecord) => {
          if (record.type !== 'response' || record.id !== id) return
          clearTimeout(timeout)
          records.off('record', onRecord)
          record.success ? resolve(record) : reject(new Error(JSON.stringify(record)))
        }
        records.on('record', onRecord)
      })
      child!.stdin!.write(JSON.stringify({ id, type, ...extra }) + '\n')
      return result
    }

    await submitTurn('first', 'First user message')
    await submitTurn('second', 'Second user message')

    expect(requests).toHaveLength(3)
    expect(requests[0].model).toBe('audit-model')
    expect(requests[0].tools?.length).toBeGreaterThan(0)
    expect(requests[0].messages?.[0].role).toBe('system')
    expect(JSON.stringify(requests[0].messages?.[0])).toContain('You are a coding assistant running inside pi')
    expect(requests[1].messages?.some((message) => message.role === 'tool')).toBe(true)
    expect(requests[2].messages?.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('Second user message'))).toBe(true)

    const sessionFiles = (await readdir(sessionDirectory)).filter((name) => name.endsWith('.jsonl'))
    expect(sessionFiles).toHaveLength(1)
    const content = await readFile(path.join(sessionDirectory, sessionFiles[0]), 'utf8')
    const entries = content.trim().split('\n').map((line) => JSON.parse(line) as Record<string, any>)
    const captures = entries.filter((entry) => entry.type === 'custom' && entry.customType === 'pi-session-viewer.system-prompt')
    expect(captures).toHaveLength(2)
    expect(captures[0].data).toMatchObject({
      recordType: 'snapshot', captureStage: 'agent_start',
      piVersion: PI_VERSION, messageType: 'user',
      model: { provider: 'viewer-test', id: 'audit-model' },
    })
    expect(captures[0].data.prompt).toContain('You are a coding assistant running inside pi')
    expect(captures[0].data.composition.toolDefinitions.some((tool: { name: string }) => tool.name === 'bash')).toBe(true)
    expect(captures[1].data).toMatchObject({
      recordType: 'reference', captureStage: 'agent_start',
      piVersion: PI_VERSION, promptHash: captures[0].data.promptHash,
    })
    expect(captures[1].data.prompt).toBeUndefined()
    expect(captures[0].data.targetUserEntryId).toBeTruthy()
    expect(captures[1].data.targetUserEntryId).toBeTruthy()
    expect(captures[1].data.targetUserEntryId).not.toBe(captures[0].data.targetUserEntryId)
    expect(entries.some((entry) => entry.message?.role === 'toolResult'
      && JSON.stringify(entry.message.content).includes('viewer_tool_ok'))).toBe(true)
    expect(entries.some((entry) => entry.message?.role === 'assistant'
      && JSON.stringify(entry.message.content).includes('Second turn complete.'))).toBe(true)

    const parsed = parseSessionJsonl(content)
    expect(parsed.warnings.filter((warning) => warning.code === 'unknown-type' || warning.code === 'invalid-entry')).toEqual([])
    const view = buildSessionView(parsed)
    const toolCall = view.events.find((event) => event.kind === 'tool-call' && event.toolName === 'bash')
    expect(toolCall?.pairedEventId).toBeTruthy()
    expect(view.stats.turnCount).toBe(2)

    // Replacing the current session must reset the extension's prompt snapshot
    // cache. Resuming the previous session must instead reuse its saved snapshot.
    const commands = await submitCommand('commands', 'get_commands')
    expect(commands.data?.commands?.some((command) => command.name === 'session-viewer')).toBe(true)
    const newSession = await submitCommand('new', 'new_session')
    expect(newSession.data?.cancelled).toBe(false)
    await submitTurn('third', 'Third user message')
    const afterNew = (await readdir(sessionDirectory)).filter((name) => name.endsWith('.jsonl'))
    expect(afterNew).toHaveLength(2)
    const secondFile = afterNew.find((file) => file !== sessionFiles[0])
    expect(secondFile).toBeDefined()
    const newSessionEntries = (await readFile(path.join(sessionDirectory, secondFile!), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, any>)
    const newCapture = newSessionEntries.find((entry) => entry.customType === 'pi-session-viewer.system-prompt')
    expect(newCapture?.data).toMatchObject({ recordType: 'snapshot', piVersion: PI_VERSION })

    const resumed = await submitCommand('resume', 'switch_session', {
      sessionPath: path.join(sessionDirectory, sessionFiles[0]),
    })
    expect(resumed.data?.cancelled).toBe(false)
    await submitTurn('fourth', 'Fourth user message')
    const resumedEntries = (await readFile(path.join(sessionDirectory, sessionFiles[0]), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, any>)
    const resumedCaptures = resumedEntries.filter((entry) => entry.customType === 'pi-session-viewer.system-prompt')
    expect(resumedCaptures).toHaveLength(3)
    expect(resumedCaptures[2].data).toMatchObject({
      recordType: 'reference', piVersion: PI_VERSION,
      promptHash: captures[0].data.promptHash,
    })
    expect(requests).toHaveLength(5)
    expect(requests[4].messages?.some((message) =>
      message.role === 'user' && JSON.stringify(message.content).includes('Fourth user message'))).toBe(true)
    expect(requests[4].messages?.some((message) =>
      message.role === 'user' && JSON.stringify(message.content).includes('Third user message'))).toBe(false)
  } finally {
    if (child && !child.killed) {
      child.stdin?.end()
      if (child.exitCode === null) {
        const exited = once(child, 'exit')
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))])
        if (child.exitCode === null) child.kill('SIGKILL')
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 45_000)
