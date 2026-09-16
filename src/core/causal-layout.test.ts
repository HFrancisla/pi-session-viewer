import { describe, expect, it } from 'vitest'
import type { TimelineEvent } from './types'
import { buildCausalLayout } from './causal-layout'

function toolEvent(id: string, kind: 'tool-call' | 'tool-result', toolCallId: string): TimelineEvent {
  return {
    id,
    entryId: id,
    kind,
    title: id,
    summary: '',
    content: '',
    toolCallId,
    toolName: 'bash',
    raw: {},
  }
}

describe('buildCausalLayout', () => {
  it('keeps concurrent calls on separate lanes when results return out of order', () => {
    const layout = buildCausalLayout([
      toolEvent('call-a', 'tool-call', 'a'),
      toolEvent('call-b', 'tool-call', 'b'),
      toolEvent('result-b', 'tool-result', 'b'),
      toolEvent('result-a', 'tool-result', 'a'),
    ])

    expect(layout.maxLanes).toBe(2)
    expect(layout.byEventId.get('call-a')?.eventLane).toBe(0)
    expect(layout.byEventId.get('call-b')?.eventLane).toBe(1)
    expect(layout.byEventId.get('result-b')?.segments).toContainEqual({ callId: 'b', lane: 1, phase: 'end' })
    expect(layout.byEventId.get('result-a')?.segments).toContainEqual({ callId: 'a', lane: 0, phase: 'end' })
  })

  it('reuses the lowest lane after a result closes it', () => {
    const layout = buildCausalLayout([
      toolEvent('call-a', 'tool-call', 'a'),
      toolEvent('result-a', 'tool-result', 'a'),
      toolEvent('call-b', 'tool-call', 'b'),
      toolEvent('result-b', 'tool-result', 'b'),
    ])

    expect(layout.byEventId.get('call-b')?.eventLane).toBe(0)
    expect(layout.maxLanes).toBe(1)
  })

  it('does not extend an unmatched call through later events', () => {
    const unmatched = toolEvent('call-a', 'tool-call', 'a')
    const later: TimelineEvent = {
      id: 'assistant', entryId: 'assistant', kind: 'assistant', title: 'reply',
      summary: '', content: '', raw: {},
    }
    const layout = buildCausalLayout([unmatched, later])

    expect(layout.maxLanes).toBe(0)
    expect(layout.byEventId.get('call-a')?.segments).toEqual([])
    expect(layout.byEventId.get('assistant')?.segments).toEqual([])
  })
})
