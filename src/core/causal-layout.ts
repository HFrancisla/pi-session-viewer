import type { TimelineEvent } from './types'

export type CausalPhase = 'start' | 'pass' | 'end'

export interface CausalSegment {
  callId: string
  lane: number
  phase: CausalPhase
}

export interface CausalEventLayout {
  segments: CausalSegment[]
  eventLane?: number
}

export interface CausalLayout {
  byEventId: Map<string, CausalEventLayout>
  maxLanes: number
}

function firstFreeLane(active: Map<string, number>): number {
  const occupied = new Set(active.values())
  let lane = 0
  while (occupied.has(lane)) lane += 1
  return lane
}

function activeSegments(active: Map<string, number>, eventCallId: string | undefined, phase: CausalPhase): CausalSegment[] {
  return [...active.entries()]
    .map(([callId, lane]) => ({
      callId,
      lane,
      phase: callId === eventCallId ? phase : 'pass' as CausalPhase,
    }))
    .sort((left, right) => left.lane - right.lane)
}

export function buildCausalLayout(events: TimelineEvent[]): CausalLayout {
  const resultCallIds = new Set<string>()
  for (const event of events) {
    if (event.kind === 'tool-result' && event.toolCallId) resultCallIds.add(event.toolCallId)
  }
  const active = new Map<string, number>()
  const byEventId = new Map<string, CausalEventLayout>()
  let maxLanes = 0

  for (const event of events) {
    const callId = event.toolCallId
    if (event.kind === 'tool-call' && callId && resultCallIds.has(callId)) {
      const lane = firstFreeLane(active)
      active.set(callId, lane)
      maxLanes = Math.max(maxLanes, active.size)
      byEventId.set(event.id, {
        segments: activeSegments(active, callId, 'start'),
        eventLane: lane,
      })
      continue
    }

    if (event.kind === 'tool-result' && callId && active.has(callId)) {
      const lane = active.get(callId)
      byEventId.set(event.id, {
        segments: activeSegments(active, callId, 'end'),
        eventLane: lane,
      })
      active.delete(callId)
      continue
    }

    byEventId.set(event.id, { segments: activeSegments(active, undefined, 'pass') })
  }

  return { byEventId, maxLanes }
}

export function causalLaneX(lane: number, maxLanes: number): number {
  const firstLaneX = 38
  const lastLaneX = 74
  if (maxLanes <= 1) return firstLaneX
  const spacing = Math.min(8, (lastLaneX - firstLaneX) / (maxLanes - 1))
  return firstLaneX + lane * spacing
}
