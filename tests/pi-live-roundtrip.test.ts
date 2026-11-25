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
it.each([true, false])('真实 Pi 保留原生提示词、工具轮次（Viewer 加载：%s）', async (withViewer) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-viewer-live-'))
  const sessionDirectory = path.join(directory, 'sessions')
  const requestEvents = new EventEmitter()
  let retried = false
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
      const latestUser = requests.at(-1)?.messages?.filter(message => message.role === 'user').at(-1)
      const input = JSON.stringify(latestUser?.content)
      requestEvents.emit('request', input)
      if (input.includes('Abort request')) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.flushHeaders()
        return
      }
      if (input.includes('Failed request')) {
        response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({error:{message:'test failure'}}))
        return
      }
      if (input.includes('Retry request') && !retried) {
        retried = true
        response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' }).end(JSON.stringify({error:{message:'test retry'}}))
        return
      }

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
  pi.on('before_agent_start', event => {
    if (['Abort request', 'Failed request', 'Retry request'].includes(event.prompt)) return { systemPrompt: event.prompt + ' override' };
    if (event.prompt === 'Forced text') return { systemPrompt: 'EXPLICIT_OVERRIDE' };
    if (event.prompt === 'Forced empty') return { systemPrompt: '' };
    if (event.prompt === 'Changed tools') {
      event.systemPromptOptions.sections.custom_section = 'exact native content';
      pi.setActiveTools(['read']);
    }
  });
  pi.on('before_provider_request', event => {
    if (event.payload.messages?.[0]?.content === 'EXPLICIT_OVERRIDE') {
      return { ...event.payload, messages: event.payload.messages.map((message, i) =>
        i === 0 ? { ...message, content: 'LATE_WIRE_OVERRIDE' } : message) };
    }
  });
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
      ...(withViewer ? ['-e', extension] : []), '-e', providerExtension,
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
          if (record.success) resolve(record)
          else reject(new Error(JSON.stringify(record)))
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
    const captures = entries.filter(entry => entry.customType === 'pi-session-viewer.observation')
    if (withViewer) {
      expect(captures.length).toBeGreaterThanOrEqual(3)
      const sourceCapture = captures.find(entry => entry.data.toolSources?.some((tool: { name: string }) => tool.name === 'bash'))
      expect(sourceCapture?.data).toMatchObject({ schemaVersion: 1, piVersion: PI_VERSION })
      expect(entries.find(entry => entry.id === sourceCapture?.data.assistantEntryId)?.message.role).toBe('assistant')
      expect(captures.every(entry => entries.find(candidate => candidate.id === entry.data.assistantEntryId)?.message.role === 'assistant')).toBe(true)
    } else {
      expect(captures).toHaveLength(0)
    }
    expect(entries.some((entry) => entry.message?.role === 'toolResult'
      && JSON.stringify(entry.message.content).includes('viewer_tool_ok'))).toBe(true)
    expect(entries.some((entry) => entry.message?.role === 'assistant'
      && JSON.stringify(entry.message.content).includes('Second turn complete.'))).toBe(true)

    const parsed = parseSessionJsonl(content)
    expect(parsed.warnings.filter((warning) => warning.code === 'unknown-type' || warning.code === 'invalid-entry')).toEqual([])
    const view = buildSessionView(parsed)
    const toolCall = view.events.find((event) => event.kind === 'tool-call' && event.toolName === 'bash')
    expect(toolCall?.pairedEventId).toBeTruthy()
    expect(toolCall?.toolDefinition?.name).toBe('bash')
    if (withViewer) expect(toolCall?.toolDefinition?.sourceInfo).toBeDefined()
    else expect(toolCall?.toolDefinition?.sourceInfo).toBeUndefined()
    const definitions = view.events.find(event => event.kind === 'tool-definitions')
    const declaredBash = definitions?.toolDefinitions?.find(tool => tool.name === 'bash')
    expect(declaredBash).toBeDefined()
    if (withViewer) {
      const observed = captures.find(entry => entry.data.toolSources?.some((tool: { name: string }) => tool.name === 'bash'))!.data.toolSources.find((tool: { name: string }) => tool.name === 'bash').sourceInfo
      expect(declaredBash?.sourceInfo).toEqual(observed)
      expect(view.events.find(event => event.id === toolCall?.pairedEventId)?.toolDefinition?.sourceInfo).toEqual(observed)
    } else {
      expect(definitions?.toolDefinitions?.every(tool => tool.sourceInfo === undefined)).toBe(true)
    }
    expect(toolCall?.persistedState?.message.sections).toBeDefined()
    expect(view.stats.turnCount).toBe(2)
    if (!withViewer) {
      expect(toolCall?.persistedState?.message.toolsAdded?.length).toBeGreaterThan(0)
      return
    }

    // 新会话首次观测，恢复旧会话时沿分支复用来源。
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
    const newCapture = newSessionEntries.find((entry) => entry.customType === 'pi-session-viewer.observation')
    expect(newCapture?.data).toMatchObject({ schemaVersion: 1, piVersion: PI_VERSION })

    const resumed = await submitCommand('resume', 'switch_session', {
      sessionPath: path.join(sessionDirectory, sessionFiles[0]),
    })
    expect(resumed.data?.cancelled).toBe(false)
    await submitTurn('fourth', 'Fourth user message')
    const resumedEntries = (await readFile(path.join(sessionDirectory, sessionFiles[0]), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, any>)
    const resumedCaptures = resumedEntries.filter(entry => entry.customType === 'pi-session-viewer.observation')
    expect(resumedCaptures.length).toBeGreaterThan(captures.length)
    expect(requests).toHaveLength(5)
    expect(requests[4].messages?.some((message) =>
      message.role === 'user' && JSON.stringify(message.content).includes('Fourth user message'))).toBe(true)
    expect(requests[4].messages?.some((message) =>
      message.role === 'user' && JSON.stringify(message.content).includes('Third user message'))).toBe(false)
    await submitTurn('forced', 'Forced text')
    await submitTurn('empty', 'Forced empty')
    await submitTurn('changed', 'Changed tools')
    const extended = await readFile(path.join(sessionDirectory, sessionFiles[0]), 'utf8')
    const extendedView = buildSessionView(parseSessionJsonl(extended))
    const overrides = extendedView.events.flatMap(event => event.observation?.forcedPrompt !== undefined
      && event.kind === 'assistant' ? [event.observation.forcedPrompt] : [])
    expect(overrides).toEqual(['EXPLICIT_OVERRIDE', ''])
    expect(JSON.stringify(requests[5].messages)).toContain('LATE_WIRE_OVERRIDE')
    expect(extendedView.events.at(-1)?.persistedState?.message.sections?.custom_section).toBe('<custom_section>\nexact native content\n</custom_section>')
    expect(extendedView.events.at(-1)?.persistedState?.message.toolsAdded?.map(tool => tool.name)).toEqual(['read'])
    expect(extendedView.events.at(-1)?.observation?.forcedPrompt).toBeUndefined()

    // 失败与中止请求的强制覆盖不能泄漏到后续正常回复。
    await submitCommand('disable-retry', 'set_auto_retry', { enabled: false })
    await submitTurn('failed', 'Failed request')
    const abortSeen = once(requestEvents, 'request')
    const aborted = submitTurn('aborted', 'Abort request')
    expect((await abortSeen)[0]).toContain('Abort request')
    await submitCommand('abort', 'abort')
    await aborted
    await submitTurn('after-abort', 'Normal after abort')
    const afterAbort = buildSessionView(parseSessionJsonl(await readFile(path.join(sessionDirectory, sessionFiles[0]), 'utf8')))
    expect(afterAbort.events.some(event => event.observation?.forcedPrompt === 'Failed request override')).toBe(false)
    expect(afterAbort.events.some(event => event.observation?.forcedPrompt === 'Abort request override')).toBe(false)
    expect(afterAbort.events.at(-1)?.observation?.forcedPrompt).toBeUndefined()

    await submitCommand('enable-retry', 'set_auto_retry', { enabled: true })
    await submitTurn('retry', 'Retry request')
    expect(retried).toBe(true)
    await submitTurn('after-retry', 'Normal after retry')
    const afterRetry = buildSessionView(parseSessionJsonl(await readFile(path.join(sessionDirectory, sessionFiles[0]), 'utf8')))
    expect(afterRetry.events.at(-1)?.observation?.forcedPrompt).toBeUndefined()
    const retryOverrides = afterRetry.events.filter(event => event.observation?.forcedPrompt === 'Retry request override')
    expect(retryOverrides).toHaveLength(1)
    expect(retryOverrides[0].observation?.assistantEntryId).toBe(retryOverrides[0].entryId)

    // 从首次用户消息分叉，旧分支的强制覆盖与工具来源观测不能进入新分支。
    const firstUser = entries.find(entry => entry.message?.role === 'user')
    const fork = await submitCommand('fork', 'fork', { entryId: firstUser!.id })
    expect(fork.data?.cancelled).toBe(false)
    await submitTurn('forked', 'Forked user message')
    const forkFiles = (await readdir(sessionDirectory)).filter(name => name.endsWith('.jsonl'))
    const forkFile = forkFiles.find(name => !afterNew.includes(name))
    expect(forkFile).toBeDefined()
    const forkView = buildSessionView(parseSessionJsonl(await readFile(path.join(sessionDirectory, forkFile!), 'utf8')))
    expect(forkView.events.some(event => event.observation?.forcedPrompt !== undefined)).toBe(false)
    expect(forkView.events.some(event => event.kind === 'assistant' && event.observation?.toolSources?.length)).toBe(true)
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
