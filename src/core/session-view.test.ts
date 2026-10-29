import { describe, expect, it } from 'vitest'
import { parseSessionJsonl } from './session-parser'
import { buildSessionView, primaryEventForEntry, projectSessionView } from './session-view'
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

describe('buildSessionView', () => {
  it('restores a linear path, pairs tool calls with results, and calculates view stats', () => {
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
    expect(view.stats.turnCount).toBe(1)
    expect(view.stats.entryCount).toBe(4)
    expect(view.stats.startedAt).toBe('2026-01-01T10:00:00.000Z')
    expect(view.stats.endedAt).toBe('2026-01-01T10:00:05.000Z')
    expect(view.stats.elapsedMs).toBe(5_000)
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

    const thinking = view.events.find((event) => event.kind === 'thinking')
    const assistant = view.events.find((event) => event.kind === 'assistant')
    expect(thinking?.raw).toBe(assistant?.raw)
    expect(call?.raw).toBe(assistant?.raw)
    expect(thinking?.model).toEqual({ provider: 'demo', id: 'model-a' })
    expect(call?.model).toEqual({ provider: 'demo', id: 'model-a' })

    // Also assert projectSessionView alias
    const projected = projectSessionView(session)
    expect(projected.events).toHaveLength(view.events.length)
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
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p1',
        parentId: null,
        timestamp: '2026-01-01T10:00:00.500Z',
        data: {
          schemaVersion: 1,
          promptHash: 'empty-hash',
          promptLength: 0,
          recordType: 'snapshot',
          captureStage: 'agent_start',
          prompt: '',
          targetUserEntryId: 'u1',
        },
      },
      entry('u1', 'p1', '2026-01-01T10:00:01.000Z', { role: 'user', content: 'First turn' }),
    )

    const promptEvent = buildSessionView(parseSessionJsonl(source)).events.find((event) => event.kind === 'system-prompt')

    expect(promptEvent).toMatchObject({
      title: 'System prompt empty',
      summary: 'Captured empty effective system prompt',
      content: '',
      targetEntryId: 'u1',
      systemPrompt: { recordType: 'snapshot', promptLength: 0 },
    })
  })

  it('distinguishes an unresolved snapshot reference from an unrecorded prompt', () => {
    const source = jsonl(
      header,
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p1',
        parentId: null,
        timestamp: '2026-01-01T10:00:00.500Z',
        data: {
          schemaVersion: 1,
          promptHash: 'missing-hash',
          promptLength: 42,
          recordType: 'reference',
          captureStage: 'agent_start',
          targetUserEntryId: 'u1',
        },
      },
      entry('u1', 'p1', '2026-01-01T10:00:01.000Z', { role: 'user', content: 'First turn' }),
    )

    const promptEvent = buildSessionView(parseSessionJsonl(source)).events.find((event) => event.kind === 'system-prompt')

    expect(promptEvent).toMatchObject({
      title: 'System prompt missing',
      summary: 'Unable to resolve prompt snapshot for hash missing-hash',
      targetEntryId: 'u1',
      systemPrompt: { recordType: 'reference', promptHash: 'missing-hash', promptLength: 42 },
    })
    expect(promptEvent?.content).toContain('not in the current session file')
  })

  it('renders native Pi system snapshots and append-only prompt/tool patches', () => {
    const source = jsonl(
      header,
      entry('s1', null, '2026-01-01T10:00:00.500Z', {
        role: 'system',
        content: 'You are a coding agent.',
        sections: { preamble: 'You are a coding agent.', legacy: 'Remove me' },
        toolsAdded: [{ name: 'read' }, { name: 'bash' }],
      }),
      entry('u1', 's1', '2026-01-01T10:00:01.000Z', { role: 'user', content: 'First turn' }),
      entry('s2', 'u1', '2026-01-01T10:00:01.500Z', {
        role: 'system',
        sections: { addendum: 'Never delete files.', legacy: null },
        toolsAdded: [{ name: 'grep' }],
        toolsRemoved: ['obsolete_tool'],
      }),
      entry('a1', 's2', '2026-01-01T10:00:02.000Z', {
        role: 'assistant',
        content: [{ type: 'text', text: 'Understood.' }],
      }),
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

  it('only displays system prompt on the first turn unless the prompt changes in subsequent turns', () => {
    const promptData = {
      schemaVersion: 1,
      promptHash: 'hash-1',
      promptLength: 21,
      composition: {
        selectedTools: ['read'], toolSnippets: { read: 'Read files' }, promptGuidelines: [],
        cwd: '/work/demo', contextFiles: [], skills: [],
      },
      prompt: 'Shared system prompt',
      recordType: 'snapshot',
      captureStage: 'agent_start',
    }
    const source = jsonl(
      header,
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: null, timestamp: '2026-01-01T10:00:00.500Z', data: { ...promptData, targetUserEntryId: 'u1' } },
      entry('u1', 'p1', '2026-01-01T10:00:01.000Z', { role: 'user', content: '第一轮提问' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复 1' }] }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p2', parentId: 'a1', timestamp: '2026-01-01T10:00:02.500Z', data: { ...promptData, targetUserEntryId: 'u2' } },
      entry('u2', 'p2', '2026-01-01T10:00:03.000Z', { role: 'user', content: '第二轮提问（相同 prompt）' }),
      entry('a2', 'u2', '2026-01-01T10:00:04.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复 2' }] }),
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p3',
        parentId: 'a2',
        timestamp: '2026-01-01T10:00:04.500Z',
        data: {
          ...promptData,
          promptHash: 'hash-2',
          promptLength: 28,
          prompt: 'Updated system prompt with rules',
          targetUserEntryId: 'u3',
        },
      },
      entry('u3', 'p3', '2026-01-01T10:00:05.000Z', { role: 'user', content: '第三轮提问（更新 prompt）' }),
      entry('a3', 'u3', '2026-01-01T10:00:06.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复 3' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source), 'a3')
    const promptEvents = view.events.filter((event) => event.kind === 'system-prompt')

    expect(promptEvents).toHaveLength(2)
    expect(promptEvents[0]).toMatchObject({ title: 'System prompt', targetEntryId: 'u1' })
    expect(promptEvents[1]).toMatchObject({ title: 'System prompt update', targetEntryId: 'u3' })
    expect(view.turns[0].events[0]?.id).toBe('p1:system-prompt')
    expect(view.turns[1].events.some((event) => event.kind === 'system-prompt')).toBe(false)
    expect(view.turns[2].events[0]?.id).toBe('p3:system-prompt')
  })

  it('shows API tool schema changes separately when the system prompt hash is unchanged', () => {
    const basePromptData = {
      schemaVersion: 1,
      promptHash: 'hash-stable',
      promptLength: 21,
      prompt: 'System prompt text unchanged',
      recordType: 'snapshot',
      captureStage: 'agent_start',
    }
    const toolsV1 = [
      { name: 'read', description: 'Read file', parameters: { type: 'object' } },
    ]
    const toolsV2 = [
      { name: 'read', description: 'Read file', parameters: { type: 'object' } },
      { name: 'edit', description: 'Edit file', parameters: { type: 'object' } },
    ]

    const source = jsonl(
      header,
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p1',
        parentId: null,
        timestamp: '2026-01-01T10:00:00.500Z',
        data: {
          ...basePromptData,
          composition: {
            selectedTools: ['read'], toolSnippets: {}, promptGuidelines: [],
            cwd: '/work/demo', contextFiles: [], skills: [], toolDefinitions: toolsV1,
          },
          targetUserEntryId: 'u1',
        },
      },
      entry('u1', 'p1', '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Turn 1' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: 'Reply 1' }] }),
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p2',
        parentId: 'a1',
        timestamp: '2026-01-01T10:00:02.500Z',
        data: {
          ...basePromptData,
          composition: {
            selectedTools: ['read', 'edit'], toolSnippets: {}, promptGuidelines: [],
            cwd: '/work/demo', contextFiles: [], skills: [], toolDefinitions: toolsV2,
          },
          targetUserEntryId: 'u2',
        },
      },
      entry('u2', 'p2', '2026-01-01T10:00:03.000Z', { role: 'user', content: 'Turn 2' }),
      entry('a2', 'u2', '2026-01-01T10:00:04.000Z', { role: 'assistant', content: [{ type: 'text', text: 'Reply 2' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source), 'a2')
    const promptEvents = view.events.filter((event) => event.kind === 'system-prompt')
    const toolEvents = view.events.filter((event) => event.kind === 'tool-definitions')

    expect(promptEvents).toHaveLength(1)
    expect(toolEvents).toHaveLength(2)
    expect(toolEvents[0]).toMatchObject({ title: 'Tool Definitions', summary: 'Mounted 1 API tools', targetEntryId: 'u1' })
    expect(toolEvents[1]).toMatchObject({ title: 'Tool Definitions', summary: 'Mounted 2 API tools', targetEntryId: 'u2' })
  })

  it('surfaces mid-turn tool schema changes without claiming the prompt text changed', () => {
    const basePromptData = {
      schemaVersion: 1,
      promptHash: 'hash-stable',
      promptLength: 21,
      prompt: 'System prompt text unchanged',
      recordType: 'snapshot',
      captureStage: 'provider_request_update',
    }
    const tools = [
      { name: 'task', description: 'Run subagent task', parameters: { type: 'object' } },
    ]

    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Turn 1' }),
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p1',
        parentId: 'u1',
        timestamp: '2026-01-01T10:00:01.500Z',
        data: {
          ...basePromptData,
          composition: {
            selectedTools: ['task'], toolSnippets: {}, promptGuidelines: [],
            cwd: '/work/demo', contextFiles: [], skills: [], toolDefinitions: tools,
          },
        },
      },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: 'Reply 1' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source), 'a1')
    const promptEvents = view.events.filter((event) => event.kind === 'system-prompt')
    const toolEvents = view.events.filter((event) => event.kind === 'tool-definitions')

    expect(promptEvents).toHaveLength(2)
    expect(promptEvents[0]).toMatchObject({ title: 'System prompt unrecorded' })
    expect(promptEvents[1]).toMatchObject({ title: 'System prompt update' })
    expect(toolEvents).toHaveLength(1)
    expect(toolEvents[0]).toMatchObject({ title: 'Tool Definitions', summary: 'Mounted 1 API tools' })
  })

  it('inserts tool-definitions card with parameter schemas right after system-prompt when captured in session', () => {
    const toolDefinitions = [
      {
        name: 'grep',
        description: 'Search for regex pattern across files',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regex pattern' },
            path: { type: 'string', description: 'Search directory' },
          },
          required: ['pattern'],
        },
        promptGuidelines: ['Use grep before reading whole files'],
      },
    ]

    const promptData = {
      schemaVersion: 1,
      promptHash: 'hash-tools-1',
      promptLength: 100,
      composition: {
        customPrompt: 'You are an agent',
        selectedTools: ['grep'],
        toolSnippets: { grep: 'Search regex' },
        promptGuidelines: [],
        cwd: '/work/demo',
        contextFiles: [],
        skills: [],
        toolDefinitions,
      },
      prompt: 'Complete effective system prompt with grep',
      recordType: 'snapshot',
      captureStage: 'agent_start',
    }

    const source = jsonl(
      header,
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p1',
        parentId: null,
        timestamp: '2026-01-01T10:00:00.500Z',
        data: { ...promptData, targetUserEntryId: 'u1' },
      },
      entry('u1', 'p1', '2026-01-01T10:00:01.000Z', { role: 'user', content: '查找相关函数' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '正在查找' }] }),
    )

    const view = buildSessionView(parseSessionJsonl(source))
    const kinds = view.events.map((e) => e.kind)

    expect(kinds.slice(0, 3)).toEqual(['system-prompt', 'tool-definitions', 'user'])

    const toolDefEvent = view.events.find((e) => e.kind === 'tool-definitions')
    expect(toolDefEvent).toBeDefined()
    expect(toolDefEvent?.title).toBe('Tool Definitions')
    expect(toolDefEvent?.summary).toBe('Mounted 1 API tools')
    expect(toolDefEvent?.toolDefinitions).toEqual(toolDefinitions)
    expect(toolDefEvent?.content).toContain('"name": "grep"')
    expect(toolDefEvent?.content).toContain('"pattern"')
  })

  it('displays mounted skills in system-prompt event summary without tool counts', () => {
    const promptData = {
      schemaVersion: 1,
      promptHash: 'hash-skills-1',
      promptLength: 80,
      composition: {
        selectedTools: ['read'],
        toolSnippets: {},
        promptGuidelines: [],
        cwd: '/work/demo',
        contextFiles: [{ path: 'README.md', content: '# Docs' }],
        skills: [
          { name: 'tdd', description: 'Test driven development', filePath: '/skills/tdd/SKILL.md' },
          { name: 'review', description: 'Code review', filePath: '/skills/review/SKILL.md' },
        ],
      },
      prompt: 'Prompt with mounted skills',
      recordType: 'snapshot',
      captureStage: 'agent_start',
    }

    const source = jsonl(
      header,
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p1',
        parentId: null,
        timestamp: '2026-01-01T10:00:00.500Z',
        data: { ...promptData, targetUserEntryId: 'u1' },
      },
      entry('u1', 'p1', '2026-01-01T10:00:01.000Z', { role: 'user', content: '执行测试驱动重构' }),
    )

    const view = buildSessionView(parseSessionJsonl(source))
    const promptEvent = view.events.find((e) => e.kind === 'system-prompt')

    expect(promptEvent?.summary).toContain('Mounted 2 skills')
    expect(promptEvent?.summary).toContain('1 context file')
    expect(promptEvent?.summary).not.toContain('tool')
  })

  it('links toolDefinition with provenance to tool-call and tool-result events', () => {
    const toolDefinitions = [
      {
        name: 'mcpScript',
        description: 'Execute custom MCP tool',
        parameters: { type: 'object' },
        sourceInfo: {
          source: 'mcp',
          path: '/home/user/.pi/agent/extensions/pi-mcp-adapter/index.js',
          scope: 'project',
        },
      },
    ]

    const promptData = {
      schemaVersion: 1,
      promptHash: 'hash-prov-1',
      promptLength: 60,
      composition: {
        selectedTools: ['mcpScript'],
        toolSnippets: {},
        promptGuidelines: [],
        cwd: '/work/demo',
        contextFiles: [],
        skills: [],
        toolDefinitions,
      },
      prompt: 'Prompt with tool provenance',
      recordType: 'snapshot',
      captureStage: 'agent_start',
    }

    const source = jsonl(
      header,
      {
        type: 'custom',
        customType: 'pi-session-viewer.system-prompt',
        id: 'p1',
        parentId: null,
        timestamp: '2026-01-01T10:00:00.500Z',
        data: { ...promptData, targetUserEntryId: 'u1' },
      },
      entry('u1', 'p1', '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Run mcp script' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call-mcp-1', name: 'mcpScript', arguments: { arg: 'val' } },
        ],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:03.000Z', {
        role: 'toolResult',
        toolCallId: 'call-mcp-1',
        toolName: 'mcpScript',
        isError: false,
        content: 'success',
      }),
    )

    const view = buildSessionView(parseSessionJsonl(source))

    const callEvent = view.events.find((e) => e.kind === 'tool-call')
    expect(callEvent?.toolDefinition).toBeDefined()
    expect(callEvent?.toolDefinition?.name).toBe('mcpScript')
    expect(callEvent?.toolDefinition?.sourceInfo?.path).toBe('/home/user/.pi/agent/extensions/pi-mcp-adapter/index.js')

    const resultEvent = view.events.find((e) => e.kind === 'tool-result')
    expect(resultEvent?.toolDefinition).toBeDefined()
    expect(resultEvent?.toolDefinition?.name).toBe('mcpScript')
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
    expect(view.turns[0].events.map((e) => e.kind)).toEqual(['system'])
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
      promptHash: 'late-hash',
      promptLength: 20,
      recordType: 'snapshot',
      captureStage: 'agent_start',
      prompt: 'Late persisted prompt',
    }
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '第一轮提问' }),
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'p1', parentId: 'u1', timestamp: '2026-01-01T10:00:01.200Z', data: promptData },
      entry('a1', 'p1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '回复' }] }),
    )

    const session = parseSessionJsonl(source)
    const view = buildSessionView(session)

    const promptEvent = view.events.find((e) => e.kind === 'system-prompt')
    expect(promptEvent?.targetEntryId).toBe('u1')
    expect(view.turns[0].events[0]?.id).toBe('p1:system-prompt')
    expect(view.turns[0].events.map((e) => e.kind)).toEqual(['system-prompt', 'user', 'assistant'])
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

    const view = buildSessionView(parseSessionJsonl(source))
    const call = view.events.find((event) => event.kind === 'tool-call')
    const result = view.events.find((event) => event.kind === 'tool-result')

    expect(call?.subagent?.targetFile).toBe('subagent-artifacts/worker-a.jsonl')
    expect(call?.subagents?.map((reference) => reference.targetFile)).toEqual([
      'subagent-artifacts/worker-a.jsonl',
      'subagent-artifacts/worker-b.jsonl',
    ])
    expect(result?.subagent).toBeUndefined()
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

    const view = buildSessionView(parseSessionJsonl(source, '--project--/parent.jsonl'))
    const call = view.events.find((event) => event.kind === 'tool-call')
    const result = view.events.find((event) => event.kind === 'tool-result')

    expect(call?.subagent?.agentName).toBe('delegate')
    expect(call?.subagent?.targetFile).toBe(sessionFile)
    expect(call?.subagents).toBeUndefined()
    expect(result?.subagent).toBeUndefined()
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

    const view = buildSessionView(parseSessionJsonl(source, '--project--/parent.jsonl'))
    const call = view.events.find((event) => event.kind === 'tool-call')
    const result = view.events.find((event) => event.kind === 'tool-result')

    expect(call?.subagent?.agentName).toBe('delegate')
    expect(call?.subagent?.targetFile).toBe('--project--/run-0/session.jsonl')
    expect(call?.subagents).toBeUndefined()
    expect(result?.subagent).toBeUndefined()
  })

  it('links asynchronous subagent notifications to their tool call by runId', () => {
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
    const callEvent = view.events.find((event) => event.kind === 'tool-call')
    const resultEvent = view.events.find((event) => event.kind === 'tool-result')

    expect(callEvent?.subagent).toMatchObject({
      targetFile: `--project--/parent/${runId}/run-0/session.jsonl`,
      agentName: 'worker',
      sessionName: 'worker: Inspect the change',
      runId,
    })
    expect(callEvent?.subagents).toBeUndefined()
    expect(resultEvent?.subagent).toBeUndefined()
  })

  it('links workflow child Sessions to the invoking tool call', () => {
    const workflowRunId = '7df2a179-13a8-469a-a68a-bad6cbceb09c'
    const childRuns = [
      { runId: '11111111-1111-4111-8111-111111111111', workflowKey: 'inspect-readme', agent: 'scout', status: 'completed' },
      { runId: '22222222-2222-4222-8222-222222222222', workflowKey: 'inspect-package', agent: 'delegate', status: 'completed' },
    ]
    const sourceName = '/home/user/.pi/agent/sessions/--project--/parent.jsonl'
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Run a workflow' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-workflow', name: 'subagent', arguments: { workflow: true } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-workflow', toolName: 'subagent', content: 'Workflow completed',
        details: { mode: 'workflow', runId: workflowRunId, toolCallId: 'call-workflow', results: [], workflowChildren: { children: [] } },
      }),
      {
        type: 'custom_message', customType: 'subagent-notify', id: 'n1', parentId: 'r1',
        timestamp: '2026-01-01T10:00:03.000Z', content: 'Workflow completed',
        details: {
          runs: [{
            agent: 'workflow', status: 'completed', runId: workflowRunId, workflowRunId,
            childRuns,
            childOutputs: childRuns.map((child) => ({
              ...child,
              outputArtifactPath: `/home/user/.pi/agent/sessions/--project--/subagent-artifacts/${child.runId}_${child.agent}_output.md`,
            })),
          }],
        },
      },
    )

    const view = buildSessionView(parseSessionJsonl(source, sourceName))
    const callEvent = view.events.find((event) => event.kind === 'tool-call')
    const resultEvent = view.events.find((event) => event.kind === 'tool-result')

    expect(callEvent?.subagents?.map((reference) => [reference.agentName, reference.targetFile])).toEqual([
      ['scout', '--project--/subagent-artifacts/11111111-1111-4111-8111-111111111111_scout_transcript.jsonl'],
      ['delegate', '--project--/subagent-artifacts/22222222-2222-4222-8222-222222222222_delegate_transcript.jsonl'],
    ])
    expect(callEvent?.subagent).toMatchObject({ runId: childRuns[0].runId, sessionName: 'inspect-readme' })
    expect(resultEvent?.subagent).toBeUndefined()
    expect(resultEvent?.subagents).toBeUndefined()
  })

  it('links workflow child inventory from the tool result without a completion notice', () => {
    const workflowRunId = '7df2a179-13a8-469a-a68a-bad6cbceb09c'
    const children = [
      { childId: 'inspect-readme', runId: '11111111-1111-4111-8111-111111111111', agent: 'scout', sessionName: 'inspect-readme', state: 'completed' },
      { childId: 'inspect-package', runId: '22222222-2222-4222-8222-222222222222', agent: 'delegate', sessionName: 'inspect-package', state: 'completed' },
    ]
    const sourceName = '/home/user/.pi/agent/sessions/--project--/parent.jsonl'
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Run a workflow' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-workflow', name: 'subagent', arguments: { workflow: true } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-workflow', toolName: 'subagent', content: 'Workflow completed',
        details: {
          mode: 'workflow', runId: workflowRunId, toolCallId: 'call-workflow', results: [],
          workflowChildren: {
            version: 1, parentToolCallId: 'call-workflow', workflowRunId, inventoryComplete: true,
            workflowState: 'completed', children,
          },
        },
      }),
    )

    const view = buildSessionView(parseSessionJsonl(source, sourceName))
    const callEvent = view.events.find((event) => event.kind === 'tool-call')

    expect(callEvent?.subagents?.map((reference) => [reference.agentName, reference.targetFile])).toEqual([
      ['scout', '--project--/subagent-artifacts/11111111-1111-4111-8111-111111111111_scout_transcript.jsonl'],
      ['delegate', '--project--/subagent-artifacts/22222222-2222-4222-8222-222222222222_delegate_transcript.jsonl'],
    ])
  })

  it('does not duplicate a runnable result path with its workflow transcript mirror', () => {
    const workflowRunId = '7df2a179-13a8-469a-a68a-bad6cbceb09c'
    const childRunId = '11111111-1111-4111-8111-111111111111'
    const sourceName = '/home/user/.pi/agent/sessions/--project--/parent.jsonl'
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Run a workflow' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-workflow', name: 'subagent', arguments: { workflow: true } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-workflow', toolName: 'subagent', content: 'Workflow completed',
        details: {
          mode: 'workflow', runId: workflowRunId, toolCallId: 'call-workflow',
          results: [{
            agent: 'scout', runId: childRunId, sessionName: 'inspect-readme',
            sessionFile: `/home/user/.pi/agent/sessions/--project--/parent/${childRunId}/run-0/session.jsonl`,
          }],
          workflowChildren: {
            version: 1, parentToolCallId: 'call-workflow', workflowRunId, inventoryComplete: true,
            workflowState: 'completed',
            children: [{ childId: 'inspect-readme', runId: childRunId, agent: 'scout', sessionName: 'inspect-readme', state: 'completed' }],
          },
        },
      }),
    )

    const view = buildSessionView(parseSessionJsonl(source, sourceName))
    const callEvent = view.events.find((event) => event.kind === 'tool-call')

    expect(callEvent?.subagent?.targetFile).toBe(`--project--/parent/${childRunId}/run-0/session.jsonl`)
    expect(callEvent?.subagents).toBeUndefined()
  })

  it('resolves workflow transcript fallbacks relative to an absolute parent source path', () => {
    const workflowRunId = '7df2a179-13a8-469a-a68a-bad6cbceb09c'
    const childRun = { runId: '11111111-1111-4111-8111-111111111111', agent: 'scout', sessionName: 'inspect-readme' }
    const sourceName = '/home/user/.pi/agent/sessions/--project--/parent.jsonl'
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Run a workflow' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-workflow', name: 'subagent', arguments: { workflow: true } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-workflow', toolName: 'subagent', content: 'Workflow completed',
        details: { mode: 'workflow', runId: workflowRunId, toolCallId: 'call-workflow', results: [] },
      }),
      {
        type: 'custom_message', customType: 'subagent-notify', id: 'n1', parentId: 'r1',
        timestamp: '2026-01-01T10:00:03.000Z', content: 'Workflow completed',
        details: { runs: [{ agent: 'workflow', runId: workflowRunId, childRuns: [childRun] }] },
      },
    )

    const view = buildSessionView(parseSessionJsonl(source, sourceName))
    const callEvent = view.events.find((event) => event.kind === 'tool-call')

    expect(callEvent?.subagent?.targetFile).toBe(
      '--project--/subagent-artifacts/11111111-1111-4111-8111-111111111111_scout_transcript.jsonl',
    )
  })

  it('does not duplicate an inventory child for a root-level parent with a runnable Session path', () => {
    const workflowRunId = '7df2a179-13a8-469a-a68a-bad6cbceb09c'
    const childRunId = '11111111-1111-4111-8111-111111111111'
    const sourceName = 'parent.jsonl'
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Run a workflow' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-workflow', name: 'subagent', arguments: { workflow: true } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-workflow', toolName: 'subagent', content: 'Workflow completed',
        details: {
          mode: 'workflow', runId: workflowRunId, toolCallId: 'call-workflow', results: [],
          workflowChildren: {
            version: 1, parentToolCallId: 'call-workflow', workflowRunId, inventoryComplete: true,
            workflowState: 'completed',
            children: [{ childId: 'inspect-readme', runId: childRunId, agent: 'scout', sessionName: 'inspect-readme', state: 'completed' }],
          },
        },
      }),
      {
        type: 'custom_message', customType: 'subagent-notify', id: 'n1', parentId: 'r1',
        timestamp: '2026-01-01T10:00:03.000Z', content: 'Workflow completed',
        details: {
          runs: [{
            agent: 'workflow', runId: workflowRunId,
            childRuns: [{
              runId: childRunId, agent: 'scout',
              sessionValue: `parent/${childRunId}/run-0/session.jsonl`,
            }],
          }],
        },
      },
    )

    const view = buildSessionView(parseSessionJsonl(source, sourceName))
    const callEvent = view.events.find((event) => event.kind === 'tool-call')

    expect(callEvent?.subagent?.targetFile).toBe(
      `subagent-artifacts/${childRunId}_scout_transcript.jsonl`,
    )
    expect(callEvent?.subagents).toBeUndefined()
  })

  it('does not show a subagent entry for a management call without child Sessions', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:00.000Z', { role: 'user', content: 'Read the workflow guide' }),
      entry('a1', 'u1', '2026-01-01T10:00:01.000Z', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-guide', name: 'subagent', arguments: { action: 'guide', topic: 'workflows' } }],
      }),
      entry('r1', 'a1', '2026-01-01T10:00:02.000Z', {
        role: 'toolResult', toolCallId: 'call-guide', toolName: 'subagent', content: 'Guide content',
        details: { mode: 'management', results: [] },
      }),
    )

    const view = buildSessionView(parseSessionJsonl(source))

    expect(view.events.find((event) => event.kind === 'tool-call')?.subagent).toBeUndefined()
    expect(view.events.find((event) => event.kind === 'tool-result')?.subagent).toBeUndefined()
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
    const calls = view.events.filter((event) => event.kind === 'tool-call')
    const results = view.events.filter((event) => event.kind === 'tool-result')

    expect(results).toHaveLength(2)
    expect(calls.every((call) => call.subagent === undefined)).toBe(true)
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

  it('models a context edit that omits its target from model context', () => {
    const userMessage = entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Draft message' })
    const edit = {
      type: 'context_edit',
      id: 'e1',
      parentId: 'u1',
      timestamp: '2026-01-01T10:00:02.000Z',
      targetId: 'u1',
      replacement: null,
    }
    const view = buildSessionView(parseSessionJsonl(jsonl(header, userMessage, edit)))
    const editEvent = view.events.find((e) => e.kind === 'system' && e.title === 'Context Edit')

    expect(editEvent).toBeDefined()
    expect(editEvent?.content).toContain('omitted from model context')
  })

  it('shows the replacement text of a context edit', () => {
    const userMessage = entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Draft message' })
    const edit = {
      type: 'context_edit',
      id: 'e1',
      parentId: 'u1',
      timestamp: '2026-01-01T10:00:02.000Z',
      targetId: 'u1',
      replacement: 'Final prompt text',
    }
    const view = buildSessionView(parseSessionJsonl(jsonl(header, userMessage, edit)))
    const editEvent = view.events.find((e) => e.kind === 'system' && e.title === 'Context Edit')

    expect(editEvent).toBeDefined()
    expect(editEvent?.content).toContain('Final prompt text')
  })

  it('models a usage entry with its kind, model, and tokens', () => {
    const userMessage = entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Hi' })
    const usage = {
      type: 'usage',
      id: 'us1',
      parentId: 'u1',
      timestamp: '2026-01-01T10:00:02.000Z',
      kind: 'cache_write',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      usage: { input: 100, output: 200, totalTokens: 300 },
    }
    const view = buildSessionView(parseSessionJsonl(jsonl(header, userMessage, usage)))
    const usageEvent = view.events.find((e) => e.kind === 'system' && e.title === 'Usage: cache_write')

    expect(usageEvent).toBeDefined()
    expect(usageEvent?.content).toContain('Model: anthropic / claude-3-7-sonnet')
    expect(usageEvent?.content).toContain('input=100, output=200, totalTokens=300')
  })
})

describe('buildSessionView: what the model actually received', () => {
  const source = jsonl(
    header,
    entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'First prompt' }),
    entry('a1', 'u1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] }),
    entry('u2', 'a1', '2026-01-01T10:00:03.000Z', { role: 'user', content: 'Second prompt' }),
  )

  it('marks the events a projection excludes and leaves the rest alone', () => {
    const parsed = parseSessionJsonl(source)
    const projection: ContextProjection = {
      leafId: 'u2',
      messageCount: 1,
      contextEntryCount: 1,
      excluded: {
        u1: { state: 'omitted' },
        a1: { state: 'not-in-context' },
      },
    }
    const view = buildSessionView(parsed, 'u2', projection)

    const u1 = view.events.find((e) => e.entryId === 'u1' && e.kind === 'user')
    const a1 = view.events.find((e) => e.entryId === 'a1' && e.kind === 'assistant')
    const u2 = view.events.find((e) => e.entryId === 'u2' && e.kind === 'user')

    expect(u1?.contextExclusion).toEqual({ state: 'omitted' })
    expect(a1?.contextExclusion).toEqual({ state: 'not-in-context' })
    expect(u2?.contextExclusion).toBeUndefined()
  })

  it('counts excluded events per turn', () => {
    const parsed = parseSessionJsonl(source)
    const projection: ContextProjection = {
      leafId: 'u2',
      messageCount: 1,
      contextEntryCount: 1,
      excluded: {
        u1: { state: 'omitted' },
        a1: { state: 'omitted' },
      },
    }
    const turns = buildSessionView(parsed, 'u2', projection).turns

    expect(turns[0].contextExcludedCount).toBe(2)
    expect(turns[1].contextExcludedCount).toBeUndefined()
  })

  it('marks nothing when no projection was provided', () => {
    const parsed = parseSessionJsonl(source)
    const view = buildSessionView(parsed, 'u2')

    expect(view.events.every((e) => !e.contextExclusion)).toBe(true)
    expect(view.turns.every((t) => !t.contextExcludedCount)).toBe(true)
  })
})

describe('buildSessionView: the two ends of a context edit', () => {
  const baseSession = jsonl(
    header,
    entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Original prompt' }),
    entry('a1', 'u1', '2026-01-01T10:00:02.000Z', {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'false' } },
      ],
    }),
    entry('r1', 'a1', '2026-01-01T10:00:03.000Z', {
      role: 'toolResult', toolCallId: 'c1', toolName: 'bash', isError: true, content: 'failed',
    }),
  )

  const withEdit = jsonl(
    baseSession,
    {
      type: 'context_edit',
      id: 'e1',
      parentId: 'r1',
      timestamp: '2026-01-01T10:00:04.000Z',
      targetId: 'a1',
      replacement: null,
    },
  )

  it('links the edit to its target and names what else it removed', () => {
    const parsed = parseSessionJsonl(withEdit)
    const projection: ContextProjection = {
      leafId: 'e1',
      messageCount: 1,
      contextEntryCount: 1,
      excluded: {
        a1: { state: 'omitted', editId: 'e1' },
        r1: { state: 'omitted', editId: 'e1' },
      },
    }
    const view = buildSessionView(parsed, 'e1', projection)
    const editEvent = view.events.find((e) => e.entryId === 'e1')

    expect(editEvent?.contextEdit).toEqual({
      targetEntryId: 'a1',
      targetOnBranch: true,
      affectedEntryIds: ['a1', 'r1'],
    })
    expect(editEvent?.content).toContain('Target: a1')
    expect(editEvent?.content).toContain('Call bash')
    expect(editEvent?.content).toContain('omitted from model context')
    expect(editEvent?.content).toContain('Also removed from model context: a1, r1')
  })

  it('reports a target that is not on the shown branch instead of guessing', () => {
    const offBranch = jsonl(
      baseSession,
      {
        type: 'context_edit',
        id: 'e1',
        parentId: 'r1',
        timestamp: '2026-01-01T10:00:04.000Z',
        targetId: 'nonexistent-entry',
        replacement: null,
      },
    )
    const parsed = parseSessionJsonl(offBranch)
    const projection: ContextProjection = {
      leafId: 'e1',
      messageCount: 1,
      contextEntryCount: 1,
      excluded: {},
    }
    const view = buildSessionView(parsed, 'e1', projection)
    const editEvent = view.events.find((e) => e.entryId === 'e1')

    expect(editEvent?.contextEdit).toEqual({
      targetEntryId: 'nonexistent-entry',
      targetOnBranch: false,
      affectedEntryIds: [],
    })
    expect(editEvent?.content).toContain('(not on this branch)')
  })

  it('resolves the replacement text of a replacing edit', () => {
    const replaced = jsonl(
      baseSession,
      {
        type: 'context_edit',
        id: 'e2',
        parentId: 'r1',
        timestamp: '2026-01-01T10:00:04.000Z',
        targetId: 'a1',
        replacement: 'Alternative answer',
      },
    )
    const parsed = parseSessionJsonl(replaced)
    const view = buildSessionView(parsed, 'e2', { leafId: 'e2', messageCount: 2, contextEntryCount: 3, excluded: {} })
    const editEvent = view.events.find((e) => e.entryId === 'e2')

    expect(editEvent?.content).toContain('model context replaced with:\n\nAlternative answer')
  })

  it('adds no link when no projection was provided', () => {
    const parsed = parseSessionJsonl(withEdit)
    const view = buildSessionView(parsed, 'e1')
    const editEvent = view.events.find((e) => e.entryId === 'e1')

    expect(editEvent?.contextEdit).toBeUndefined()
  })
})

describe('primaryEventForEntry', () => {
  it('selects assistant before thinking or tool-call', () => {
    const view = buildSessionView(parseSessionJsonl(jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'test' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'think' },
          { type: 'text', text: 'reply' },
          { type: 'toolCall', id: 'c1', name: 'read', arguments: {} },
        ],
      }),
    )))
    const a1Events = view.events.filter((e) => e.entryId === 'a1')
    const primary = primaryEventForEntry(a1Events)
    expect(primary?.kind).toBe('assistant')
  })
})
