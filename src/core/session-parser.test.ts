import { describe, expect, it } from 'vitest'
import { buildSessionView, getSessionTitle, parseSessionJsonl } from './session-parser'
import type { ContextProjection } from './types'

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
      summary: 'No system-prompt capture record is associated with this turn; the reason is unknown.',
      targetEntryId: 'u1',
      systemPrompt: { recordType: 'missing' },
    })
    expect(view.events[0]?.content).toContain('does not establish whether the run had no system prompt')
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

  it('marks every user turn without an associated system-prompt capture as unrecorded', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'First turn' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', {
        role: 'assistant', content: [{ type: 'text', text: 'First reply' }],
      }),
      entry('u2', 'a1', '2026-01-01T10:00:03.000Z', { role: 'user', content: 'Later turn without a capture' }),
      entry('a2', 'u2', '2026-01-01T10:00:04.000Z', {
        role: 'assistant', content: [{ type: 'text', text: 'Later reply' }],
      }),
    )

    const view = buildSessionView(parseSessionJsonl(source))
    const markers = view.events.filter((event) => event.title === 'System prompt unrecorded')

    expect(markers.map((event) => event.targetEntryId)).toEqual(['u1', 'u2'])
  })

  it('distinguishes an explicitly captured empty effective prompt', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Run child task' }),
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p1',
        parentId: 'u1',
        timestamp: '2026-01-01T10:00:01.100Z',
        data: {
          schemaVersion: 1,
          recordType: 'snapshot',
          promptHash: 'empty-prompt-hash',
          prompt: '',
          promptLength: 0,
          targetUserEntryId: 'u1',
        },
      },
    )

    const promptEvent = buildSessionView(parseSessionJsonl(source)).events.find((event) => event.kind === 'system-prompt')

    expect(promptEvent).toMatchObject({
      title: 'System prompt empty',
      summary: 'Captured empty effective system prompt',
      content: '',
      systemPrompt: { recordType: 'snapshot', promptLength: 0 },
    })
  })

  it('distinguishes an unresolved snapshot reference from an unrecorded prompt', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Run child task' }),
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p1',
        parentId: 'u1',
        timestamp: '2026-01-01T10:00:01.100Z',
        data: {
          schemaVersion: 1,
          recordType: 'reference',
          promptHash: 'missing-prompt-hash',
          targetUserEntryId: 'u1',
        },
      },
    )

    const promptEvent = buildSessionView(parseSessionJsonl(source)).events.find((event) => event.kind === 'system-prompt')

    expect(promptEvent).toMatchObject({
      title: 'System prompt missing',
      summary: 'Unable to resolve prompt snapshot for hash missing-prompt-hash',
      systemPrompt: { recordType: 'reference' },
    })
    expect(promptEvent?.content).toContain('complete system prompt snapshot')
  })

  it('renders native Pi system snapshots and append-only prompt/tool patches', () => {
    const source = jsonl(
      header,
      entry('system-0', null, '2026-01-01T10:00:00.500Z', {
        role: 'system',
        content: '',
        sections: { preamble: 'You are a coding agent.', tools: '<tools>read</tools>' },
        toolsAdded: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }],
      }),
      entry('u1', 'system-0', '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Inspect this file' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: 'I will inspect it.' }] }),
      entry('system-1', 'a1', '2026-01-01T10:00:03.000Z', {
        role: 'system',
        content: '',
        sections: { addendum: 'Keep the answer concise.', legacy: null },
        toolsAdded: [{ name: 'grep', description: 'Search files', parameters: { type: 'object' } }],
        toolsRemoved: [{ name: 'obsolete_tool' }],
      }),
      entry('u2', 'system-1', '2026-01-01T10:00:04.000Z', { role: 'user', content: 'Search for a function' }),
    )

    const events = buildSessionView(parseSessionJsonl(source)).events
    const initial = events.find((event) => event.title === 'Pi system context snapshot')
    const update = events.find((event) => event.title === 'Pi system context update')

    expect(initial?.content).toContain('You are a coding agent.')
    expect(initial?.content).toContain('"name": "read"')
    expect(update?.summary).toContain('2 prompt section changes')
    expect(update?.content).toContain('Section <addendum>')
    expect(update?.content).toContain('Removed section <legacy>')
    expect(update?.content).toContain('"name": "grep"')
    expect(update?.content).toContain('obsolete_tool')
    expect(events.some((event) => event.title === 'System prompt unrecorded')).toBe(false)
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

  it('shows API tool schema changes separately when the system prompt hash is unchanged', () => {
    const readTool = {
      name: 'read', description: 'Read files',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    }
    const bashTool = {
      name: 'bash', description: 'Run commands',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
    }
    const promptHash = 'same-prompt-hash'
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'First turn' }),
      {
        type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'u1',
        timestamp: '2026-01-01T10:00:01.100Z',
        data: {
          schemaVersion: 1, recordType: 'snapshot', promptHash, prompt: 'Same effective system prompt',
          promptLength: 28, targetUserEntryId: 'u1',
          composition: {
            selectedTools: ['read'], toolDefinitions: [readTool], toolSnippets: {}, promptGuidelines: [],
            cwd: '/work/demo', contextFiles: [], skills: [],
          },
        },
      },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: 'First reply' }] }),
      entry('u2', 'a1', '2026-01-01T10:00:03.000Z', { role: 'user', content: 'Tools changed' }),
      {
        type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p2', parentId: 'u2',
        timestamp: '2026-01-01T10:00:03.100Z',
        data: {
          schemaVersion: 1, recordType: 'reference', promptHash, promptLength: 28, targetUserEntryId: 'u2',
          composition: { toolDefinitions: [readTool, bashTool] },
        },
      },
      entry('a2', 'p2', '2026-01-01T10:00:04.000Z', { role: 'assistant', content: [{ type: 'text', text: 'Second reply' }] }),
      entry('u3', 'a2', '2026-01-01T10:00:05.000Z', { role: 'user', content: 'Same tools' }),
      {
        type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p3', parentId: 'u3',
        timestamp: '2026-01-01T10:00:05.100Z',
        data: {
          schemaVersion: 1, recordType: 'reference', promptHash, promptLength: 28, targetUserEntryId: 'u3',
          composition: { toolDefinitions: [bashTool, readTool] },
        },
      },
      entry('a3', 'p3', '2026-01-01T10:00:06.000Z', { role: 'assistant', content: [{ type: 'text', text: 'Third reply' }] }),
      entry('u4', 'a3', '2026-01-01T10:00:07.000Z', { role: 'user', content: 'Tools disabled' }),
      {
        type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p4', parentId: 'u4',
        timestamp: '2026-01-01T10:00:07.100Z',
        data: {
          schemaVersion: 1, recordType: 'reference', promptHash, promptLength: 28, targetUserEntryId: 'u4',
          composition: { toolDefinitions: [] },
        },
      },
      entry('a4', 'p4', '2026-01-01T10:00:08.000Z', { role: 'assistant', content: [{ type: 'text', text: 'Fourth reply' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source), 'a4')
    const promptEvents = view.events.filter((event) => event.kind === 'system-prompt')
    const toolDefinitionEvents = view.events.filter((event) => event.kind === 'tool-definitions')

    expect(promptEvents).toHaveLength(1)
    expect(toolDefinitionEvents).toHaveLength(3)
    expect(toolDefinitionEvents[1]?.toolDefinitions?.map((tool) => tool.name)).toEqual(['read', 'bash'])
    expect(toolDefinitionEvents[2]?.summary).toBe('No active API tools')
    expect(toolDefinitionEvents[2]?.toolDefinitions).toEqual([])
    expect(view.turns[1].events.map((event) => event.kind)).toEqual(['tool-definitions', 'user', 'assistant'])
    expect(view.turns[2].events.map((event) => event.kind)).toEqual(['user', 'assistant'])
    expect(view.turns[3].events.map((event) => event.kind)).toEqual(['tool-definitions', 'user', 'assistant'])
  })

  it('surfaces mid-turn tool schema changes without claiming the prompt text changed', () => {
    const readTool = {
      name: 'read', description: 'Read files',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    }
    const bashTool = {
      name: 'bash', description: 'Run commands',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
    }
    const promptHash = 'same-prompt-hash'
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Run the task' }),
      {
        type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'u1',
        timestamp: '2026-01-01T10:00:01.100Z',
        data: {
          schemaVersion: 1, recordType: 'snapshot', captureStage: 'agent_start', promptHash,
          prompt: 'Same effective system prompt', promptLength: 28, targetUserEntryId: 'u1',
          composition: {
            selectedTools: ['read'], toolDefinitions: [readTool], toolSnippets: {}, promptGuidelines: [],
            cwd: '/work/demo', contextFiles: [], skills: [],
          },
        },
      },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: 'Thinking' }] }),
      {
        type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p2', parentId: 'a1',
        timestamp: '2026-01-01T10:00:03.000Z',
        data: {
          schemaVersion: 1, recordType: 'reference', captureStage: 'provider_request_update', promptHash,
          promptLength: 28, sequence: 2, composition: { toolDefinitions: [readTool, bashTool] },
        },
      },
      entry('a2', 'p2', '2026-01-01T10:00:04.000Z', { role: 'assistant', content: [{ type: 'text', text: 'Final reply' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source))
    const promptEvents = view.events.filter((event) => event.kind === 'system-prompt')
    const toolDefinitionEvents = view.events.filter((event) => event.kind === 'tool-definitions')

    expect(promptEvents).toHaveLength(1)
    expect(promptEvents[0]?.title).toBe('System prompt')
    expect(toolDefinitionEvents).toHaveLength(2)
    expect(toolDefinitionEvents[1]?.toolDefinitions?.map((tool) => tool.name)).toEqual(['read', 'bash'])
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

    const promptEvent = view.events.find((e) => e.kind === 'system-prompt')
    expect(promptEvent).toBeDefined()
    expect(promptEvent?.summary).toBe('Full snapshot')

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

  it('displays mounted skills in system-prompt event summary without tool counts', () => {
    const promptData = {
      schemaVersion: 1,
      promptHash: 'skills-hash',
      promptLength: 50,
      composition: {
        selectedTools: ['read', 'bash'],
        skills: [
          { name: 'tdd', description: 'TDD' },
          { name: 'review', description: 'Review' },
        ],
        contextFiles: [],
        promptGuidelines: [],
        cwd: '/work/demo',
      },
    }
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '测试' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'u1', timestamp: '2026-01-01T10:00:01.100Z', data: { ...promptData, recordType: 'snapshot', prompt: 'Prompt with skills', targetUserEntryId: 'u1', sequence: 1 } },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source))
    const promptEvent = view.events.find((e) => e.kind === 'system-prompt')
    expect(promptEvent).toBeDefined()
    expect(promptEvent?.summary).toBe('Mounted 2 skills')
  })

  it('links toolDefinition with provenance to tool-call and tool-result events', () => {
    const promptData = {
      schemaVersion: 1,
      promptHash: 'tools-prov-hash',
      promptLength: 20,
      composition: {
        selectedTools: ['mcpScript'],
        toolDefinitions: [
          {
            name: 'mcpScript',
            description: 'Run MCP script',
            parameters: { type: 'object' },
            sourceInfo: {
              path: '/home/user/.pi/agent/extensions/pi-mcp-adapter/index.js',
              source: 'local',
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
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '测试工具' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'u1', timestamp: '2026-01-01T10:00:01.100Z', data: { ...promptData, recordType: 'snapshot', prompt: 'Prompt', targetUserEntryId: 'u1', sequence: 1 } },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'c1', name: 'mcpScript', arguments: { cmd: 'status' } },
        ],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:03.000Z', {
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'mcpScript',
        content: 'OK',
      }),
    )

    const view = buildSessionView(parseSessionJsonl(source))
    const callEvent = view.events.find((e) => e.kind === 'tool-call')
    expect(callEvent).toBeDefined()
    expect(callEvent?.toolName).toBe('mcpScript')
    expect(callEvent?.toolDefinition).toBeDefined()
    expect(callEvent?.toolDefinition?.sourceInfo?.path).toBe('/home/user/.pi/agent/extensions/pi-mcp-adapter/index.js')

    const resultEvent = view.events.find((e) => e.kind === 'tool-result')
    expect(resultEvent?.toolDefinition).toBeDefined()
    expect(resultEvent?.toolDefinition?.name).toBe('mcpScript')
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

  it('keeps distinct child Sessions when result items share an outer runId', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Start a worker group' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'subagent', arguments: { task: 'Parallel work' } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-1', toolName: 'subagent', content: 'Workers completed',
        details: {
          runId: 'batch-1',
          results: [
            {
              agent: 'worker-a', sessionFile: 'subagent-artifacts/worker-a.jsonl',
              artifactPaths: { jsonlPath: 'subagent-artifacts/worker-a-artifact.jsonl' },
            },
            {
              agent: 'worker-b', sessionFile: 'subagent-artifacts/worker-b.jsonl',
              artifactPaths: { jsonlPath: 'subagent-artifacts/worker-b-artifact.jsonl' },
            },
            {
              agent: 'worker-a-duplicate', sessionFile: 'subagent-artifacts/worker-a.jsonl',
              artifactPaths: { jsonlPath: 'subagent-artifacts/worker-a-artifact.jsonl' },
            },
          ],
          artifacts: {
            files: [
              { jsonlPath: 'subagent-artifacts/worker-a-artifact.jsonl' },
              { jsonlPath: 'subagent-artifacts/worker-b-artifact.jsonl' },
            ],
          },
        },
      }),
    )

    const result = buildSessionView(parseSessionJsonl(source)).events.find((event) => event.kind === 'tool-result')

    expect(result?.subagent?.targetFile).toBe('subagent-artifacts/worker-a.jsonl')
    expect(result?.subagents?.map((reference) => reference.targetFile)).toEqual([
      'subagent-artifacts/worker-a.jsonl',
      'subagent-artifacts/worker-b.jsonl',
    ])
  })

  it('counts one child Session when its artifact JSONL is also listed', () => {
    const sessionFile = '--project--/2026-10-21T06-19-19-982Z_01a15d1d/run-0/session.jsonl'
    const artifactPath = '--project--/subagent-artifacts/de5fc68b_delegate_0.jsonl'
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Start one subagent' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'subagent', arguments: { agent: 'delegate', task: 'Complete one task' } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-1', toolName: 'subagent', content: 'Child completed',
        details: {
          mode: 'single',
          runId: 'de5fc68b-7e42-471f-ad0e-9c10bb39650e',
          results: [{
            agent: 'delegate',
            sessionFile,
            artifactPaths: { jsonlPath: artifactPath },
          }],
          artifacts: { files: [{ jsonlPath: artifactPath }] },
        },
      }),
    )

    const result = buildSessionView(parseSessionJsonl(source, '--project--/parent.jsonl'))
      .events.find((event) => event.kind === 'tool-result')

    expect(result?.subagent?.agentName).toBe('delegate')
    expect(result?.subagent?.targetFile).toBe(sessionFile)
    expect(result?.subagents).toBeUndefined()
  })

  it('does not infer additional children from unmatched artifact files when results identify a child', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Start one subagent' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'subagent', arguments: { agent: 'delegate', task: 'Complete one task' } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-1', toolName: 'subagent', content: 'Child completed',
        details: {
          mode: 'single',
          runId: 'single-run',
          results: [{ agent: 'delegate', sessionFile: '--project--/run-0/session.jsonl' }],
          artifacts: { files: [{ jsonlPath: '--project--/subagent-artifacts/unmatched.jsonl' }] },
        },
      }),
    )

    const result = buildSessionView(parseSessionJsonl(source, '--project--/parent.jsonl'))
      .events.find((event) => event.kind === 'tool-result')

    expect(result?.subagent?.agentName).toBe('delegate')
    expect(result?.subagent?.targetFile).toBe('--project--/run-0/session.jsonl')
    expect(result?.subagents).toBeUndefined()
  })

  it('detects subagent references and attaches them to tool-result events', () => {
    const source = jsonl(
      entry('s1', null, '2026-01-01T10:00:00.000Z', {
        type: 'session',
        id: 'main-session',
      }),
      entry('u1', 's1', '2026-01-01T10:00:00.000Z', {
        role: 'user',
        content: 'Investigate leak',
      }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'subagent',
            arguments: { agent: 'code-analyzer', task: 'Check memory leaks' },
          },
        ],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'subagent',
        content: JSON.stringify({
          status: 'success',
          sessionFile: 'subagent-artifacts/analyzer-run.jsonl',
        }),
      }),
    )

    const view = buildSessionView(parseSessionJsonl(source))
    const callEvent = view.events.find((e) => e.kind === 'tool-call')
    const resultEvent = view.events.find((e) => e.kind === 'tool-result')

    expect(callEvent?.subagent).toBeUndefined()

    expect(resultEvent?.subagent).toBeDefined()
    expect(resultEvent?.subagent?.targetFile).toBe('subagent-artifacts/analyzer-run.jsonl')
    expect(resultEvent?.subagent?.agentName).toBe('code-analyzer')
    expect(resultEvent?.subagent?.task).toBe('Check memory leaks')
  })

  it('links asynchronous subagent notifications to their tool-result by runId', () => {
    const runId = '7df2a179-13a8-469a-a68a-bad6cbceb09c'
    const childSession = `/home/user/.pi/agent/sessions/--project--/parent/${runId}/run-0/session.jsonl`
    const sourceName = '/home/user/.pi/agent/sessions/--project--/parent.jsonl'
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', {
        role: 'user', content: 'Start an asynchronous subagent',
      }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{
          type: 'toolCall', id: 'call-async', name: 'subagent',
          arguments: { agent: 'worker', task: 'Inspect the change' },
        }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-async', toolName: 'subagent',
        content: [{ type: 'text', text: 'Worker launched' }],
        details: { runId, toolCallId: 'call-async', results: [] },
      }),
      {
        type: 'custom_message', customType: 'subagent-notify', id: 'n1', parentId: 'r1',
        timestamp: '2026-01-01T10:00:03.000Z',
        content: `Worker session: ${childSession}`,
        details: {
          runs: [{
            agent: 'worker', status: 'completed', runId,
            sessionLabel: 'worker: Inspect the change', sessionValue: childSession,
          }],
        },
      },
      {
        type: 'custom_message', customType: 'unrelated-event', id: 'n2', parentId: 'n1',
        timestamp: '2026-01-01T10:00:04.000Z',
        content: 'An unrelated path is not a subagent reference.',
        details: {
          runs: [{
            agent: 'unrelated', runId,
            sessionValue: `/home/user/.pi/agent/sessions/--project--/unrelated/${runId}/session.jsonl`,
          }],
        },
      },
    )

    const view = buildSessionView(parseSessionJsonl(source, sourceName))
    const resultEvent = view.events.find((event) => event.kind === 'tool-result')

    expect(resultEvent?.subagent).toMatchObject({
      targetFile: `--project--/parent/${runId}/run-0/session.jsonl`,
      agentName: 'worker',
      sessionName: 'worker: Inspect the change',
      runId,
    })
    expect(resultEvent?.subagents).toBeUndefined()
  })

  it('does not link an asynchronous notice when its runId matches multiple results', () => {
    const runId = '7df2a179-13a8-469a-a68a-bad6cbceb09c'
    const childSession = `/home/user/.pi/agent/sessions/--project--/parent/${runId}/run-0/session.jsonl`
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Start workers' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'subagent', arguments: {} }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-1', toolName: 'subagent', content: 'Worker launched',
        details: { runId, toolCallId: 'call-1', results: [] },
      }),
      entry('a2', 'r1', '2026-01-01T10:00:03.000Z', {
        role: 'assistant', content: [{ type: 'toolCall', id: 'call-2', name: 'subagent', arguments: {} }],
      }),
      entry('r2', 'a2', '2026-01-01T10:00:04.000Z', {
        role: 'toolResult', toolCallId: 'call-2', toolName: 'subagent', content: 'Worker launched',
        details: { runId, toolCallId: 'call-2', results: [] },
      }),
      {
        type: 'custom_message', customType: 'subagent-notify', id: 'n1', parentId: 'r2',
        timestamp: '2026-01-01T10:00:05.000Z', content: `Worker session: ${childSession}`,
        details: { runs: [{ agent: 'worker', runId, sessionValue: childSession }] },
      },
    )

    const view = buildSessionView(parseSessionJsonl(source))
    const results = view.events.filter((event) => event.kind === 'tool-result')

    expect(results).toHaveLength(2)
    expect(results.every((result) => result.subagent === undefined)).toBe(true)
  })

  it('does not infer a child Session from a generic sessionId in an ordinary tool result', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Run ordinary work' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'grep', arguments: { pattern: 'session' } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-1', toolName: 'grep', content: 'Search complete',
        details: { sessionId: 'ordinary-job-42' },
      }),
    )

    const result = buildSessionView(parseSessionJsonl(source)).events.find((event) => event.kind === 'tool-result')

    expect(result?.subagent).toBeUndefined()
  })

  it('does not treat a grep match for a subagent artifact path as a child Session reference', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Search for paths' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'grep-1', name: 'grep', arguments: { pattern: 'session path' } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'grep-1', toolName: 'grep',
        content: [{ type: 'text', text: 'docs/example.md: subagent-artifacts/not-a-session.jsonl' }],
      }),
    )

    const result = buildSessionView(parseSessionJsonl(source)).events.find((event) => event.kind === 'tool-result')

    expect(result?.subagent).toBeUndefined()
  })
})

describe('parseSessionJsonl: entry types documented by Pi', () => {
  /**
   * Shapes below are Pi's own examples from `docs/session-format.md`; the exact
   * coverage of that document is asserted by `tests/pi-entry-contract.test.ts`.
   */
  const contextEdit = (replacement: unknown) => ({
    type: 'context_edit', id: 'g6h7i8j9', parentId: 'u1', timestamp: '2026-01-01T10:00:11.000Z',
    targetId: 'a1', replacement,
  })
  const usage = {
    type: 'usage', id: 'f6g7h8i9', parentId: 'u1', timestamp: '2026-01-01T10:00:12.000Z',
    kind: 'cache_warm', provider: 'anthropic', model: 'claude-sonnet-4-5',
    usage: {
      input: 0, output: 0, cacheRead: 50000, cacheWrite: 0, totalTokens: 50000,
      cost: { input: 0, output: 0, cacheRead: 0.015, cacheWrite: 0, total: 0.015 },
    },
  }
  const userMessage = entry('u1', null, '2026-01-01T10:00:01.000Z', {
    role: 'user', timestamp: 1_767_261_601_000, content: 'hello',
  })

  it('models a context edit that omits its target from model context', () => {
    const parsed = parseSessionJsonl(jsonl(header, userMessage, entry('a1', 'u1', '2026-01-01T10:00:05.000Z', {
      role: 'assistant', timestamp: 1_767_261_605_000, content: [{ type: 'text', text: 'original' }],
    }), contextEdit(null)))

    expect(parsed.warnings).toEqual([])
    const view = buildSessionView(parsed)
    const event = view.events.find((candidate) => candidate.entryId === 'g6h7i8j9')
    expect(event?.title).toBe('Context Edit')
    expect(event?.content).toContain('Target: a1')
    expect(event?.content).toContain('omitted from model context')
  })

  it('shows the replacement text of a context edit', () => {
    const parsed = parseSessionJsonl(jsonl(header, userMessage, contextEdit('replacement text')))
    const view = buildSessionView(parsed)
    const event = view.events.find((candidate) => candidate.entryId === 'g6h7i8j9')

    expect(event?.content).toContain('Target: a1')
    expect(event?.content).toContain('replacement text')
  })

  it('models a usage entry with its kind, model, and tokens', () => {
    const parsed = parseSessionJsonl(jsonl(header, userMessage, usage))

    expect(parsed.warnings).toEqual([])
    const view = buildSessionView(parsed)
    const event = view.events.find((candidate) => candidate.entryId === 'f6g7h8i9')
    expect(event?.title).toBe('Usage: cache_warm')
    expect(event?.content).toContain('anthropic / claude-sonnet-4-5')
    expect(event?.content).toContain('totalTokens=50000')
    expect(event?.model).toEqual({ provider: 'anthropic', id: 'claude-sonnet-4-5' })
  })

  it('does not warn about an unknown entry type it has never seen', () => {
    const future = { type: 'future_entry', id: 'x1', parentId: 'u1', timestamp: '2026-01-01T10:00:13.000Z' }
    const parsed = parseSessionJsonl(jsonl(header, userMessage, future))

    expect(parsed.warnings.map((warning) => warning.code)).toEqual(['unknown-type'])
    const view = buildSessionView(parsed)
    expect(view.events.find((candidate) => candidate.entryId === 'x1')?.title).toBe('Unknown event: future_entry')
  })
})

describe('buildSessionView: what the model actually received', () => {
  const source = jsonl(
    header,
    entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', timestamp: 1_767_261_601_000, content: '跑测试' }),
    entry('a1', 'u1', '2026-01-01T10:00:02.000Z', {
      role: 'assistant', timestamp: 1_767_261_602_000, stopReason: 'error', errorMessage: '502',
      provider: 'demo', model: 'model-a', content: [{ type: 'text', text: '失败的尝试' }],
    }),
    { type: 'context_edit', id: 'e1', parentId: 'a1', timestamp: '2026-01-01T10:00:03.000Z', targetId: 'a1', replacement: null },
  )

  it('marks the events a projection excludes and leaves the rest alone', () => {
    const parsed = parseSessionJsonl(source)
    const projection: ContextProjection = {
      leafId: 'e1',
      messageCount: 1,
      contextEntryCount: 3,
      excluded: { a1: { state: 'omitted', editId: 'e1' } },
    }

    const view = buildSessionView(parsed, 'e1', projection)
    const marked = view.events.filter((event) => event.contextExclusion)
    expect(marked.map((event) => event.entryId)).toEqual(['a1'])
    expect(marked[0].contextExclusion).toEqual({ state: 'omitted', editId: 'e1' })
    // The excluded row is still rendered: the raw record is not hidden from view.
    expect(view.events.some((event) => event.entryId === 'a1')).toBe(true)
  })

  it('counts excluded events per turn', () => {
    const parsed = parseSessionJsonl(source)
    const projection: ContextProjection = {
      leafId: 'e1',
      messageCount: 1,
      contextEntryCount: 3,
      excluded: { a1: { state: 'omitted', editId: 'e1' } },
    }

    const turns = buildSessionView(parsed, 'e1', projection).turns
    const turnWithExcluded = turns.find((turn) => turn.events.some((event) => event.entryId === 'a1'))
    expect(turnWithExcluded, 'the excluded entry belongs to a turn').toBeDefined()
    expect(turnWithExcluded?.contextExcludedCount).toBe(1)
    // Turns that contain nothing excluded carry no count at all.
    for (const turn of turns) {
      if (turn === turnWithExcluded) continue
      expect(turn.contextExcludedCount).toBeUndefined()
    }
  })

  it('marks nothing when no projection was provided', () => {
    const parsed = parseSessionJsonl(source)
    const view = buildSessionView(parsed, 'e1')

    expect(view.events.every((event) => event.contextExclusion === undefined)).toBe(true)
    expect(view.turns.every((turn) => turn.contextExcludedCount === undefined)).toBe(true)
  })
})

describe('buildSessionView: the two ends of a context edit', () => {
  const withEdit = jsonl(
    header,
    entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', timestamp: 1_767_261_601_000, content: '跑测试' }),
    entry('a1', 'u1', '2026-01-01T10:00:02.000Z', {
      role: 'assistant', timestamp: 1_767_261_602_000, stopReason: 'error', errorMessage: '502',
      provider: 'demo', model: 'model-a', content: [{ type: 'text', text: '失败的尝试：我先跑一遍测试' }],
    }),
    { type: 'context_edit', id: 'e1', parentId: 'a1', timestamp: '2026-01-01T10:00:03.000Z', targetId: 'a1', replacement: null },
  )

  it('links the edit to its target and names what else it removed', () => {
    const parsed = parseSessionJsonl(withEdit)
    const projection: ContextProjection = {
      leafId: 'e1',
      messageCount: 1,
      contextEntryCount: 3,
      excluded: {
        a1: { state: 'omitted', editId: 'e1' },
        'tr-1': { state: 'omitted', editId: 'e1' },
      },
    }

    const view = buildSessionView(parsed, 'e1', projection)
    const edit = view.events.find((event) => event.entryId === 'e1')

    expect(edit?.contextEdit).toEqual({
      targetEntryId: 'a1',
      targetOnBranch: true,
      affectedEntryIds: ['a1', 'tr-1'],
    })
    // The row summary and the inspector content identify the target by preview.
    expect(edit?.summary).toContain('失败的尝试：我先跑一遍测试')
    expect(edit?.content).toContain('Target: a1')
    expect(edit?.content).toContain('Pi Response — 失败的尝试：我先跑一遍测试')
    expect(edit?.content).toContain('Also removed from model context: a1, tr-1')
  })

  it('reports a target that is not on the shown branch instead of guessing', () => {
    const parsed = parseSessionJsonl(withEdit)
    const projection: ContextProjection = {
      leafId: 'e1',
      messageCount: 1,
      contextEntryCount: 3,
      excluded: {},
    }

    const view = buildSessionView(parsed, 'e1', projection)
    const edit = view.events.find((event) => event.entryId === 'e1')

    expect(edit?.contextEdit?.targetOnBranch).toBe(true)
    // With no projection entry there is nothing removed, so the list stays empty.
    expect(edit?.contextEdit?.affectedEntryIds).toEqual([])
    expect(edit?.content).toContain('Also removed from model context: none')
  })

  it('resolves the replacement text of a replacing edit', () => {
    const replaced = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', timestamp: 1_767_261_601_000, content: 'hi' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', {
        role: 'assistant', timestamp: 1_767_261_602_000, provider: 'demo', model: 'model-a',
        content: [{ type: 'text', text: 'original answer' }],
      }),
      { type: 'context_edit', id: 'e2', parentId: 'a1', timestamp: '2026-01-01T10:00:03.000Z', targetId: 'a1', replacement: 'shortened answer' },
    )

    const parsed = parseSessionJsonl(replaced)
    const view = buildSessionView(parsed, 'e2', { leafId: 'e2', messageCount: 2, contextEntryCount: 3, excluded: {} })
    const edit = view.events.find((event) => event.entryId === 'e2')

    expect(edit?.content).toContain('Effect: model context replaced with:')
    expect(edit?.content).toContain('shortened answer')
  })

  it('adds no link when no projection was provided', () => {
    const parsed = parseSessionJsonl(withEdit)
    const view = buildSessionView(parsed, 'e1')

    expect(view.events.find((event) => event.entryId === 'e1')?.contextEdit).toBeUndefined()
  })
})
