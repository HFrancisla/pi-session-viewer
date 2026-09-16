import { describe, expect, it } from 'vitest'
import { buildSessionView, getSessionTitle, parseSessionJsonl } from './session-parser'

function jsonl(...lines: unknown[]): string {
  return lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n')
}

const header = {
  type: 'session',
  version: 3,
  id: 'session-1',
  timestamp: '2026-01-01T10:00:00.000Z',
  cwd: '/work/demo',
}

function entry(id: string, parentId: string | null, timestamp: string, message: unknown) {
  return { type: 'message', id, parentId, timestamp, message }
}

describe('parseSessionJsonl', () => {
  it('restores a linear path and pairs tool calls with results', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', {
        role: 'user', timestamp: 1_767_261_601_000, content: '检查构建失败',
      }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', {
        role: 'assistant',
        timestamp: 1_767_261_602_000,
        provider: 'demo',
        model: 'model-a',
        content: [
          { type: 'thinking', thinking: '需要先运行测试。' },
          { type: 'text', text: '我先检查测试输出。' },
          { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'npm test' } },
        ],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:04.500Z', {
        role: 'toolResult', timestamp: 1_767_261_604_500, toolCallId: 'call-1', toolName: 'bash', isError: false,
        content: [{ type: 'text', text: '3 tests passed' }],
      }),
      entry('a2', 'r1', '2026-01-01T10:00:05.000Z', {
        role: 'assistant', timestamp: 1_767_261_605_000, content: [{ type: 'text', text: '测试已经通过。' }],
      }),
    )

    const session = parseSessionJsonl(source, 'fixture.jsonl')
    const view = buildSessionView(session, session.currentLeafId)
    const call = view.events.find((event) => event.kind === 'tool-call')
    const result = view.events.find((event) => event.kind === 'tool-result')

    expect(session.warnings).toEqual([])
    expect(session.stats.turnCount).toBe(1)
    expect(view.turns).toHaveLength(1)
    expect(view.events.map((event) => event.kind)).toEqual([
      'system-prompt', 'user', 'thinking', 'assistant', 'tool-call', 'tool-result', 'assistant',
    ])
    expect(view.events[0]).toMatchObject({
      title: '系统提示词未记录',
      targetEntryId: 'u1',
      systemPrompt: { recordType: 'missing' },
    })
    expect(call?.pairedEventId).toBe(result?.id)
    expect(result?.pairedEventId).toBe(call?.id)
    expect(result?.gapMs).toBe(2_500)
    expect(getSessionTitle(session)).toBe('检查构建失败')
  })

  it('keeps historical leaves and builds the requested branch', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '选择方案' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '共同起点' }] }),
      entry('old', 'a1', '2026-01-01T10:00:03.000Z', { role: 'assistant', content: [{ type: 'text', text: '旧分支' }] }),
      entry('new', 'a1', '2026-01-01T10:00:04.000Z', { role: 'assistant', content: [{ type: 'text', text: '当前分支' }] }),
    )

    const session = parseSessionJsonl(source)
    const oldBranch = buildSessionView(session, 'old')
    const currentBranch = buildSessionView(session, session.currentLeafId)

    expect(session.currentLeafId).toBe('new')
    expect(session.branches).toHaveLength(2)
    expect(session.branches[0]).toMatchObject({ leafId: 'new', isCurrent: true, label: '当前路径' })
    expect(oldBranch.events.at(-1)?.content).toBe('旧分支')
    expect(currentBranch.events.at(-1)?.content).toBe('当前分支')
  })

  it('continues after malformed, unknown, and disconnected entries', () => {
    const source = jsonl(
      header,
      '{"type":"message",',
      { type: 'future_event', id: 'future', parentId: 'missing', timestamp: '2026-01-01T10:00:02.000Z', payload: 1 },
      entry('u1', null, '2026-01-01T10:00:03.000Z', { role: 'user', content: '仍可查看' }),
    )

    const session = parseSessionJsonl(source)
    const warningCodes = session.warnings.map((warning) => warning.code)

    expect(session.entries).toHaveLength(2)
    expect(warningCodes).toContain('invalid-json')
    expect(warningCodes).toContain('unknown-type')
    expect(warningCodes).toContain('missing-parent')
    expect(buildSessionView(session, 'future').events[0]).toMatchObject({ kind: 'system', title: '未知事件：future_event' })
  })

  it('resolves deduplicated system prompt references and places them before each user', () => {
    const promptData = {
      schemaVersion: 1,
      promptHash: 'hash-1',
      promptLength: 21,
      composition: {
        selectedTools: ['read'], toolSnippets: { read: 'Read files' }, promptGuidelines: [],
        cwd: '/work/demo', contextFiles: [], skills: [],
      },
    }
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '第一轮' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'u1', timestamp: '2026-01-01T10:00:01.100Z', data: { ...promptData, recordType: 'snapshot', prompt: 'Captured system prompt', targetUserEntryId: 'u1', sequence: 1 } },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复一' }] }),
      entry('u2', 'a1', '2026-01-01T10:00:03.000Z', { role: 'user', content: '第二轮' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p2', parentId: 'u2', timestamp: '2026-01-01T10:00:03.100Z', data: { ...promptData, recordType: 'reference', targetUserEntryId: 'u2', sequence: 2 } },
      entry('a2', 'p2', '2026-01-01T10:00:04.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复二' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source), 'a2')
    const promptEvents = view.events.filter((event) => event.kind === 'system-prompt')

    expect(view.events.map((event) => event.kind)).toEqual([
      'system-prompt', 'user', 'assistant', 'system-prompt', 'user', 'assistant',
    ])
    expect(promptEvents.map((event) => event.content)).toEqual(['Captured system prompt', 'Captured system prompt'])
    expect(promptEvents.map((event) => event.systemPrompt?.recordType)).toEqual(['snapshot', 'reference'])
    expect(promptEvents[1].systemPrompt?.composition?.selectedTools).toEqual(['read'])
  })

  it('uses a session name before the first user message', () => {
    const source = jsonl(
      header,
      { type: 'session_info', id: 'info', parentId: null, timestamp: '2026-01-01T10:00:00.500Z', name: '构建诊断' },
      entry('u1', 'info', '2026-01-01T10:00:01.000Z', { role: 'user', content: '原始问题' }),
    )
    expect(getSessionTitle(parseSessionJsonl(source))).toBe('构建诊断')
  })
})
