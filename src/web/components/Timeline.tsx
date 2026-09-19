import { AlertTriangle, Bot, Boxes, Brain, CheckCheck, CheckCircle2, ChevronDown, CircleUserRound, Cog, ScrollText, Square, Wrench, XCircle } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, type ComponentType } from 'react'
import { buildCausalLayout, causalLaneX, type CausalEventLayout } from '../../core/causal-layout'
import { allEventKinds } from '../../core/event-kinds'
import { formatClock, formatDuration } from '../../core/format'
import type { EventKind, ParsedSession, SubagentReference, TimelineEvent, TimelineTurn } from '../../core/types'
import { useI18n } from '../i18n'

const kindMeta: Record<EventKind, { icon: ComponentType<{ size?: number; className?: string }>; color: string }> = {
  'system-prompt': { icon: ScrollText, color: '#8a4f68' },
  'tool-definitions': { icon: Boxes, color: '#2f6f8f' },
  user: { icon: CircleUserRound, color: '#485c66' },
  assistant: { icon: Bot, color: '#246b83' },
  thinking: { icon: Brain, color: '#765a9a' },
  'tool-call': { icon: Wrench, color: '#a66a18' },
  'tool-result': { icon: CheckCircle2, color: '#2f7d57' },
  system: { icon: Cog, color: '#66716d' },
}

interface TimelineProps {
  session: ParsedSession
  turns: TimelineTurn[]
  allEvents: TimelineEvent[]
  selectedEventId: string | null
  restorePosition?: { eventId: string | null; scrollTop?: number; key: number } | null
  selectedLeafId: string | null
  enabledKinds: Set<EventKind>
  onSelectEvent: (event: TimelineEvent) => void
  onSelectBranch: (leafId: string) => void
  onToggleKind: (kind: EventKind) => void
  onToggleAllKinds: () => void
  onOpenSubagent?: (subagent: SubagentReference, sourceEventId?: string) => void
}

interface LlmOutputGroup {
  id: string
  events: TimelineEvent[]
  isLlmOutput: boolean
}

function isLlmOutputEvent(event: TimelineEvent): boolean {
  return event.kind === 'assistant' || event.kind === 'thinking' || event.kind === 'tool-call'
}

function groupLlmOutputEvents(events: TimelineEvent[]): LlmOutputGroup[] {
  const groups: LlmOutputGroup[] = []
  for (const event of events) {
    const shouldGroup = isLlmOutputEvent(event)
    const previous = groups.at(-1)
    if (shouldGroup && previous?.isLlmOutput && previous.id === event.entryId) {
      previous.events.push(event)
    } else {
      groups.push({
        id: shouldGroup ? event.entryId : event.id,
        events: [event],
        isLlmOutput: shouldGroup,
      })
    }
  }
  return groups
}

function EventRow({ event, selected, causal, maxLanes, highlightedCallId, mutedCallIds, onSelect, onOpenSubagent }: {
  event: TimelineEvent
  selected: boolean
  causal: CausalEventLayout
  maxLanes: number
  highlightedCallId?: string
  mutedCallIds?: Set<string>
  onSelect: () => void
  onOpenSubagent?: (subagent: SubagentReference, sourceEventId?: string) => void
}) {
  const { t, localizeTitle } = useI18n()
  const meta = kindMeta[event.kind]
  const Icon = event.kind === 'tool-result' && event.isError ? XCircle : meta.icon
  const isPairRelated = Boolean(highlightedCallId && event.toolCallId === highlightedCallId)
  const charCount = event.content?.length

  return (
    <button
      className={`event-row event--${event.kind}${selected ? ' is-selected' : ''}${isPairRelated ? ' is-pair-related' : ''}`}
      type="button"
      id={`event-row-${event.id}`}
      data-event-id={event.id}
      onClick={onSelect}
      data-tool-call-id={event.toolCallId}
      style={{ '--event-color': event.isError ? '#b24b4b' : meta.color } as React.CSSProperties}
    >
      <span className="event-time">
        <span>{formatClock(event.timestamp)}</span>
        {event.gapMs != null && <small>+{formatDuration(event.gapMs)}</small>}
      </span>
      <span className="event-track" aria-hidden="true">
        <span className="track-dot"><Icon size={14} /></span>
        {causal.segments.map((segment) => {
          const isHighlighted = highlightedCallId === segment.callId
          const isMuted = Boolean(mutedCallIds?.has(segment.callId))
          return (
            <span
              className={`causal-rail causal-rail--${segment.phase}${isHighlighted ? ' is-highlighted' : ''}${isMuted ? ' is-muted' : ''}`}
              data-call-id={segment.callId}
              key={segment.callId}
              style={{ '--lane-x': `${causalLaneX(segment.lane, maxLanes)}px` } as React.CSSProperties}
            />
          )
        })}
      </span>
      <span className="event-copy">
        <span className="event-title-line">
          <strong>{localizeTitle(event.title)}</strong>
          {causal.eventLane != null && <span className="lane-label">#{causal.eventLane + 1}</span>}
          {event.kind === 'tool-result' && (
            <>
              <span className={`event-status ${event.isError ? 'is-error' : 'is-success'}`}>
                {event.isError ? t.common.failed : t.common.success}
              </span>
              {event.subagent && (
                <span
                  className="event-subagent-tag"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect()
                    onOpenSubagent?.(event.subagent!, event.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      onSelect()
                      onOpenSubagent?.(event.subagent!, event.id)
                    }
                  }}
                  title={event.subagents && event.subagents.length > 1 ? `${event.subagents.length} subagents` : t.timeline.openSubagent}
                >
                  <Bot size={12} />
                  <span>
                    {event.subagents && event.subagents.length > 1
                      ? `${event.subagents.length} ${t.timeline.subagentTag}`
                      : (event.subagent.agentName ?? t.timeline.subagentTag)}
                  </span>
                  <span className="subagent-tag-arrow">→</span>
                </span>
              )}
            </>
          )}
          {charCount != null && event.kind !== 'system' && (
            <span className="event-char-count">{t.common.chars(charCount)}</span>
          )}
        </span>
        <span className="event-summary">{event.summary}</span>
      </span>
    </button>
  )
}

export function Timeline({
  session,
  turns,
  allEvents,
  selectedEventId,
  restorePosition,
  selectedLeafId,
  enabledKinds,
  onSelectEvent,
  onSelectBranch,
  onToggleKind,
  onToggleAllKinds,
  onOpenSubagent,
}: TimelineProps) {
  const { t, localizeTitle } = useI18n()
  const causalLayout = buildCausalLayout(allEvents)
  const selectedEvent = allEvents.find((event) => event.id === selectedEventId)
  const highlightedCallId = selectedEvent?.toolCallId

  const mutedCallIds = useMemo(() => {
    if (!highlightedCallId) return new Set<string>()

    const groupCallIds = new Set<string>()

    // 1. Sibling tool calls dispatched in the same LLM assistant entry
    const toolCallEvent = allEvents.find((e) => e.kind === 'tool-call' && e.toolCallId === highlightedCallId)
    if (toolCallEvent) {
      for (const ev of allEvents) {
        if (ev.entryId === toolCallEvent.entryId && ev.toolCallId && ev.toolCallId !== highlightedCallId) {
          groupCallIds.add(ev.toolCallId)
        }
      }
    }

    // 2. Tool calls that concurrently overlap with highlightedCallId in causal segments
    const overlappingGraph = new Map<string, Set<string>>()
    for (const layout of causalLayout.byEventId.values()) {
      const activeIds = layout.segments.map((s) => s.callId)
      if (activeIds.length > 1) {
        for (const id of activeIds) {
          let set = overlappingGraph.get(id)
          if (!set) {
            set = new Set()
            overlappingGraph.set(id, set)
          }
          for (const other of activeIds) {
            if (other !== id) set.add(other)
          }
        }
      }
    }

    const queue = [highlightedCallId, ...groupCallIds]
    const visited = new Set<string>([highlightedCallId])
    while (queue.length > 0) {
      const current = queue.pop()!
      const neighbors = overlappingGraph.get(current)
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor)
            groupCallIds.add(neighbor)
            queue.push(neighbor)
          }
        }
      }
    }

    return groupCallIds
  }, [highlightedCallId, allEvents, causalLayout])

  const visibleEventCount = turns.reduce((count, turn) => count + turn.events.length, 0)
  const allSelected = allEventKinds.length > 0 && allEventKinds.every((kind) => enabledKinds.has(kind))

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!restorePosition) return
    const container = scrollContainerRef.current
    if (!container) return

    if (restorePosition.scrollTop != null) {
      container.scrollTop = restorePosition.scrollTop
      requestAnimationFrame(() => {
        if (container && restorePosition.scrollTop != null) {
          container.scrollTop = restorePosition.scrollTop
        }
      })
    } else if (restorePosition.eventId) {
      const el = document.getElementById(`event-row-${restorePosition.eventId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'nearest' })
      }
    }
  }, [restorePosition])

  return (
    <section className="timeline-panel" aria-label={t.timeline.ariaLabel}>
      <div className="filter-bar">
        <span className="filter-label">{t.timeline.filterLabel}</span>
        <div className="filter-options">
          {allEventKinds.map((kind) => {
            const FilterIcon = kindMeta[kind].icon
            return (
              <label key={kind} style={{ '--filter-color': kindMeta[kind].color } as React.CSSProperties}>
                <input type="checkbox" checked={enabledKinds.has(kind)} onChange={() => onToggleKind(kind)} />
                <FilterIcon className="filter-kind-icon" size={13} />
                {t.timeline.kinds[kind]}
              </label>
            )
          })}
        </div>
        <button
          type="button"
          className={`filter-select-all${allSelected ? ' is-all-selected' : ''}`}
          onClick={onToggleAllKinds}
          title={allSelected ? t.timeline.deselectAllTitle : t.timeline.selectAllTitle}
        >
          {allSelected ? <Square size={13} /> : <CheckCheck size={13} />}
          {allSelected ? t.timeline.deselectAll : t.timeline.selectAll}
        </button>
      </div>

      <div className="branch-bar">
        <label htmlFor="branch-select">{t.timeline.branchLabel}</label>
        <select id="branch-select" value={selectedLeafId ?? ''} onChange={(event) => onSelectBranch(event.target.value)}>
          {session.branches.map((branch) => (
            <option key={branch.leafId} value={branch.leafId}>{localizeTitle(branch.label)}</option>
          ))}
        </select>
        <span>{t.timeline.visibleEvents(visibleEventCount)}</span>
      </div>

      {session.warnings.length > 0 && (
        <details className="warning-strip">
          <summary><AlertTriangle size={16} />{t.timeline.warningsSummary(session.warnings.length)}<ChevronDown size={15} /></summary>
          <ul>
            {session.warnings.map((warning, index) => <li key={`${warning.code}-${warning.line ?? index}`}>{warning.message}</li>)}
          </ul>
        </details>
      )}

      <div className="timeline-scroll" ref={scrollContainerRef}>
        {turns.length === 0 ? (
          <div className="timeline-empty">
            <Cog size={25} />
            <p>{enabledKinds.size === 0 ? t.timeline.emptyNoKinds : t.timeline.emptyNoEvents}</p>
          </div>
        ) : turns.map((turn) => (
          <section className="turn-group" key={turn.id}>
            <header>
              <span>{localizeTitle(turn.label)}</span>
              <span>{t.timeline.turnEvents(turn.events.length)}</span>
            </header>
            <div className="turn-events">
              {groupLlmOutputEvents(turn.events).map((group) => {
                const rows = group.events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    selected={selectedEventId === event.id}
                    causal={causalLayout.byEventId.get(event.id) ?? { segments: [] }}
                    maxLanes={causalLayout.maxLanes}
                    highlightedCallId={highlightedCallId}
                    mutedCallIds={mutedCallIds}
                    onSelect={() => onSelectEvent(event)}
                    onOpenSubagent={onOpenSubagent}
                  />
                ))
                if (!group.isLlmOutput) return rows
                return (
                  <section className="llm-output-group" key={group.id} aria-label={t.timeline.llmOutputGroup}>
                    {rows}
                  </section>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
