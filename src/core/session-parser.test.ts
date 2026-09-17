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
      title: 'System prompt unrecorded',
      targetEntryId: 'u1',
      systemPrompt: { recordType: 'missing' },
    })
    expect(call?.pairedEventId).toBe(result?.id)
    expect(result?.pairedEventId).toBe(call?.id)
    expect(result?.gapMs).toBe(2_500)
    expect(getSessionTitle(session)).toBe('检查构建失败')

    const thinking = view.events.find((event) => event.kind === 'thinking')
    const assistant = view.events.find((event) => event.kind === 'assistant')
    expect(thinking?.raw).toBe(assistant?.raw)
    expect(call?.raw).toBe(assistant?.raw)
    expect(thinking?.model).toEqual({ provider: 'demo', id: 'model-a' })
    expect(call?.model).toEqual({ provider: 'demo', id: 'model-a' })
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
    expect(session.branches[0]).toMatchObject({ leafId: 'new', isCurrent: true, label: 'Current branch' })
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
    expect(buildSessionView(session, 'future').events[0]).toMatchObject({ kind: 'system', title: 'Unknown event: future_event' })
  })

  it('only displays system prompt on the first turn unless the prompt changes in subsequent turns', () => {
    const promptData = {
      schemaVersion: 1,
      promptHash: 'hash-1',
      promptLength: 21,
      composition: {
        selectedTools: ['read'], toolSnippets: { read: 'Read files' }, promptGuidelines: [],
        cwd: '/work/demo', contextFiles: [], skills: [],
      },
    }
    const updatedPromptData = {
      ...promptData,
      promptHash: 'hash-2',
      promptLength: 28,
      composition: { ...promptData.composition, selectedTools: ['read', 'bash'] },
    }
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '第一轮' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'u1', timestamp: '2026-01-01T10:00:01.100Z', data: { ...promptData, recordType: 'snapshot', prompt: 'Captured system prompt', targetUserEntryId: 'u1', sequence: 1 } },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复一' }] }),
      entry('u2', 'a1', '2026-01-01T10:00:03.000Z', { role: 'user', content: '第二轮' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p2', parentId: 'u2', timestamp: '2026-01-01T10:00:03.100Z', data: { ...promptData, recordType: 'reference', targetUserEntryId: 'u2', sequence: 2 } },
      entry('a2', 'p2', '2026-01-01T10:00:04.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复二' }] }),
      entry('u3', 'a2', '2026-01-01T10:00:05.000Z', { role: 'user', content: '第三轮' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p3', parentId: 'u3', timestamp: '2026-01-01T10:00:05.100Z', data: { ...updatedPromptData, recordType: 'snapshot', prompt: 'Updated prompt with bash tool', targetUserEntryId: 'u3', sequence: 3 } },
      entry('a3', 'p3', '2026-01-01T10:00:06.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复三' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source), 'a3')
    const promptEvents = view.events.filter((event) => event.kind === 'system-prompt')

    expect(view.events.map((event) => event.kind)).toEqual([
      'system-prompt', 'user', 'assistant', 'user', 'assistant', 'system-prompt', 'user', 'assistant',
    ])
    expect(view.turns).toHaveLength(3)
    expect(view.turns[0].events.map((e) => e.kind)).toEqual(['system-prompt', 'user', 'assistant'])
    expect(view.turns[1].events.map((e) => e.kind)).toEqual(['user', 'assistant'])
    expect(view.turns[2].events.map((e) => e.kind)).toEqual(['system-prompt', 'user', 'assistant'])

    expect(promptEvents).toHaveLength(2)
    expect(promptEvents[0].title).toBe('System prompt')
    expect(promptEvents[0].content).toBe('Captured system prompt')
    expect(promptEvents[1].title).toBe('System prompt update')
    expect(promptEvents[1].content).toBe('Updated prompt with bash tool')
    expect(promptEvents[1].systemPrompt?.composition?.selectedTools).toEqual(['read', 'bash'])
  })

  it('inserts tool-definitions card with parameter schemas right after system-prompt when captured in session', () => {
    const promptData = {
      schemaVersion: 1,
      promptHash: 'tools-hash',
      promptLength: 20,
      composition: {
        selectedTools: ['read'],
        toolDefinitions: [
          {
            name: 'read',
            description: 'Read file contents',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
        promptGuidelines: [],
        cwd: '/work/demo',
        contextFiles: [],
        skills: [],
      },
    }
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '第一轮' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'u1', timestamp: '2026-01-01T10:00:01.100Z', data: { ...promptData, recordType: 'snapshot', prompt: 'Prompt with tools', targetUserEntryId: 'u1', sequence: 1 } },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source))
    expect(view.events.map((e) => e.kind)).toEqual(['system-prompt', 'tool-definitions', 'user', 'assistant'])
    expect(view.turns[0].events.map((e) => e.kind)).toEqual(['system-prompt', 'tool-definitions', 'user', 'assistant'])

    const toolDefEvent = view.events.find((e) => e.kind === 'tool-definitions')
    expect(toolDefEvent).toBeDefined()
    expect(toolDefEvent?.title).toBe('Tool Definitions')
    expect(toolDefEvent?.summary).toBe('Mounted 1 API tools')
    expect(toolDefEvent?.toolDefinitions?.[0]).toMatchObject({
      name: 'read',
      description: 'Read file contents',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    })
  })

  it('uses a session name before the first user message', () => {
    const source = jsonl(
      header,
      { type: 'session_info', id: 'info', parentId: null, timestamp: '2026-01-01T10:00:00.500Z', name: '构建诊断' },
      entry('u1', 'info', '2026-01-01T10:00:01.000Z', { role: 'user', content: '原始问题' }),
    )
    expect(getSessionTitle(parseSessionJsonl(source))).toBe('构建诊断')
  })

  it('infers user association for legacy snapshots without targetUserEntryId adjacent to user', () => {
    const promptData = {
      schemaVersion: 1,
      promptHash: 'legacy-hash',
      promptLength: 20,
      recordType: 'snapshot',
      captureStage: 'agent_start',
      prompt: 'Legacy system prompt',
    }
    const source = jsonl(
      header,
      { type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-01-01T10:00:00.200Z', provider: 'demo', modelId: 'model-a' },
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'm1', timestamp: '2026-01-01T10:00:00.500Z', data: promptData },
      entry('u1', 'p1', '2026-01-01T10:00:01.000Z', { role: 'user', content: '第一轮提问' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复' }] }),
    )

    const session = parseSessionJsonl(source)
    const view = buildSessionView(session)

    expect(view.turns).toHaveLength(2)
    expect(view.turns[0].label).toBe('Session setup')
    expect(view.turns[0].events.map((e) => e.kind)).toEqual(['system'])
    expect(view.turns[1].label).toBe('Turn 1')
    expect(view.turns[1].events.map((e) => e.kind)).toEqual(['system-prompt', 'user', 'assistant'])
    expect(view.turns[1].events[0]).toMatchObject({
      title: 'System prompt',
      content: 'Legacy system prompt',
      targetEntryId: 'u1',
    })
  })

  it('places system prompt snapshot before user even when persisted after user in JSONL', () => {
    const promptData = {
      schemaVersion: 1,
      promptHash: 'new-hash',
      promptLength: 20,
      recordType: 'snapshot',
      captureStage: 'agent_start',
      prompt: 'New system prompt',
      targetUserEntryId: 'u1',
    }
    const source = jsonl(
      header,
      { type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-01-01T10:00:00.200Z', provider: 'demo', modelId: 'model-a' },
      entry('u1', 'm1', '2026-01-01T10:00:01.000Z', { role: 'user', content: '新版提问' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'u1', timestamp: '2026-01-01T10:00:01.200Z', data: promptData },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '新回复' }] }),
    )

    const session = parseSessionJsonl(source)
    const view = buildSessionView(session)

    expect(view.turns).toHaveLength(2)
    expect(view.turns[0].label).toBe('Session setup')
    expect(view.turns[0].events.map((e) => e.kind)).toEqual(['system'])
    expect(view.turns[1].label).toBe('Turn 1')
    expect(view.turns[1].events.map((e) => e.kind)).toEqual(['system-prompt', 'user', 'assistant'])
    expect(view.turns[1].events[0]).toMatchObject({
      title: 'System prompt',
      content: 'New system prompt',
      targetEntryId: 'u1',
    })
  })
})
