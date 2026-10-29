import { describe, expect, it } from 'vitest'
import { getPath, getSessionTitle, KNOWN_ENTRY_TYPES, parseSessionJsonl } from './session-parser'

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

describe('parseSessionJsonl: DAG & Branch structure', () => {
  it('parses valid session header and linear entry DAG', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '检查构建失败' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', {
        role: 'assistant',
        content: [{ type: 'text', text: '我先检查测试输出。' }],
      }),
    )

    const session = parseSessionJsonl(source, 'fixture.jsonl')

    expect(session.sourceName).toBe('fixture.jsonl')
    expect(session.header?.id).toBe('session-1')
    expect(session.entries).toHaveLength(2)
    expect(session.warnings).toEqual([])
    expect(session.currentLeafId).toBe('a1')
    expect(session.branches).toEqual([
      { leafId: 'a1', label: 'Current branch', timestamp: '2026-01-01T10:00:02.000Z', isCurrent: true },
    ])
  })

  it('keeps historical leaves and resolves branch labels from label entries', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '选择方案' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: [{ type: 'text', text: '共同起点' }] }),
      entry('old', 'a1', '2026-01-01T10:00:03.000Z', { role: 'assistant', content: [{ type: 'text', text: '旧分支' }] }),
      { type: 'label', id: 'l1', parentId: 'old', timestamp: '2026-01-01T10:00:03.500Z', targetId: 'old', label: '方案 A' },
      entry('new', 'a1', '2026-01-01T10:00:04.000Z', { role: 'assistant', content: [{ type: 'text', text: '当前分支' }] }),
    )

    const session = parseSessionJsonl(source)

    expect(session.currentLeafId).toBe('new')
    expect(session.branches).toHaveLength(2)
    // Current branch is first
    expect(session.branches[0]).toMatchObject({ leafId: 'new', isCurrent: true, label: 'Current branch' })
    // Historical branch with label
    expect(session.branches[1]).toMatchObject({ leafId: 'l1', isCurrent: false, label: '方案 A' })
  })

  it('continues after malformed, unknown, and disconnected entries with warnings', () => {
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
  })

  it('detects duplicate IDs and skips duplicated lines', () => {
    const source = jsonl(
      header,
      entry('dup1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'First' }),
      entry('dup1', null, '2026-01-01T10:00:02.000Z', { role: 'user', content: 'Duplicate' }),
    )

    const session = parseSessionJsonl(source)

    expect(session.entries).toHaveLength(1)
    expect(session.warnings.some((w) => w.code === 'duplicate-id')).toBe(true)
  })

  it('warns when session header is missing', () => {
    const source = jsonl(
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: 'First' }),
    )

    const session = parseSessionJsonl(source)

    expect(session.header).toBeNull()
    expect(session.warnings.some((w) => w.code === 'invalid-header')).toBe(true)
  })

  it('detects cycles in parentId and warns without infinite recursion', () => {
    const source = jsonl(
      header,
      entry('e1', 'e2', '2026-01-01T10:00:01.000Z', { role: 'user', content: 'Part 1' }),
      entry('e2', 'e1', '2026-01-01T10:00:02.000Z', { role: 'user', content: 'Part 2' }),
    )

    const session = parseSessionJsonl(source)

    expect(session.warnings.some((w) => w.code === 'cycle')).toBe(true)
  })
})

describe('getPath', () => {
  it('returns ordered path from root to leaf', () => {
    const entries = [
      { id: '1', parentId: null, type: 'message', line: 1, raw: {} },
      { id: '2', parentId: '1', type: 'message', line: 2, raw: {} },
      { id: '3', parentId: '2', type: 'message', line: 3, raw: {} },
    ]

    const path = getPath(entries, '3')
    expect(path.map((e) => e.id)).toEqual(['1', '2', '3'])
  })

  it('stops and adds warning when cycle is detected', () => {
    const warnings: { code: string; line?: number; message: string }[] = []
    const entries = [
      { id: '1', parentId: '2', type: 'message', line: 1, raw: {} },
      { id: '2', parentId: '1', type: 'message', line: 2, raw: {} },
    ]

    const path = getPath(entries, '2', warnings as any)
    expect(path.length).toBeLessThanOrEqual(2)
    expect(warnings.some((w) => w.code === 'cycle')).toBe(true)
  })
})

describe('getSessionTitle', () => {
  it('prefers session_info entry name over user messages', () => {
    const source = jsonl(
      header,
      { type: 'session_info', id: 'info', parentId: null, timestamp: '2026-01-01T10:00:00.500Z', name: '构建诊断' },
      entry('u1', 'info', '2026-01-01T10:00:01.000Z', { role: 'user', content: '原始问题' }),
    )
    expect(getSessionTitle(parseSessionJsonl(source))).toBe('构建诊断')
  })

  it('uses first user message on current branch when session_info is absent', () => {
    const source = jsonl(
      header,
      entry('u1', null, '2026-01-01T10:00:01.000Z', { role: 'user', content: '分析架构问题' }),
      entry('a1', 'u1', '2026-01-01T10:00:02.000Z', { role: 'assistant', content: '好的' }),
    )
    expect(getSessionTitle(parseSessionJsonl(source))).toBe('分析架构问题')
  })

  it('falls back to sourceName when no user message or entries exist', () => {
    const source = jsonl(header)
    expect(getSessionTitle(parseSessionJsonl(source, 'default-session.jsonl'))).toBe('default-session.jsonl')
  })
})

describe('KNOWN_ENTRY_TYPES', () => {
  it('includes core Pi session entry types', () => {
    expect(KNOWN_ENTRY_TYPES.has('message')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('model_change')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('thinking_level_change')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('compaction')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('branch_summary')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('context_edit')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('usage')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('custom')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('custom_message')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('label')).toBe(true)
    expect(KNOWN_ENTRY_TYPES.has('session_info')).toBe(true)
  })
})
