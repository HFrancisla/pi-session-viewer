import { AlertTriangle, Bot, Boxes, Brain, CheckCheck, CheckCircle2, ChevronDown, CircleUserRound, Cog, ScrollText, Square, Wrench, XCircle } from 'lucide-react'
import { GroupedVirtuoso, type GroupedVirtuosoHandle, type GroupProps } from 'react-virtuoso'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react'
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

interface LlmOutputBoundary {
  id: string
  isStart: boolean
  isEnd: boolean
}

interface TimelineItem {
  event: TimelineEvent
  turnId: string
  llmOutputBoundary?: LlmOutputBoundary
}

function VirtualizedTurnGroup({ children, style, ...dataAttributes }: GroupProps) {
  return <section className="turn-group" role="group" style={style} {...dataAttributes}>{children}</section>
}

const timelineComponents = { Group: VirtualizedTurnGroup }

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

const EventRow = memo(function EventRow({ event, index, eventCount, turnId, selected, focused, causal, maxLanes, highlightedCallId, mutedCallIds, clockLabel, llmOutputBoundary, onSelectEvent, onFocusEvent, onOpenSubagent }: {
  event: TimelineEvent
  index: number
  eventCount: number
  turnId: string
  selected: boolean
  focused: boolean
  causal: CausalEventLayout
  maxLanes: number
  highlightedCallId?: string
  mutedCallIds?: Set<string>
  clockLabel: string
  llmOutputBoundary?: LlmOutputBoundary
  onSelectEvent: (event: TimelineEvent) => void
  onFocusEvent: (index: number) => void
  onOpenSubagent?: (subagent: SubagentReference, sourceEventId?: string) => void
}) {
  const { t, localizeTitle } = useI18n()
  const meta = kindMeta[event.kind]
  const Icon = event.kind === 'tool-result' && event.isError ? XCircle : meta.icon
  const isPairRelated = Boolean(highlightedCallId && event.toolCallId === highlightedCallId)
  const charCount = event.content?.length
  const llmOutputClasses = llmOutputBoundary
    ? ` is-llm-output-group${llmOutputBoundary.isStart ? ' llm-output-group-start' : ''}${llmOutputBoundary.isEnd ? ' llm-output-group-end' : ''}`
    : ''

  return (
    <div
      className={`event-row event--${event.kind}${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}${isPairRelated ? ' is-pair-related' : ''}${llmOutputClasses}`}
      role="option"
      aria-selected={selected}
      id={`event-row-${event.id}`}
      data-event-id={event.id}
      data-turn-id={turnId}
      aria-label={t.timeline.eventAccessibleLabel(localizeTitle(event.title), index + 1, eventCount, focused, selected)}
      onClick={() => {
        onFocusEvent(index)
        onSelectEvent(event)
      }}
      data-llm-output-group={llmOutputBoundary?.id}
      data-tool-call-id={event.toolCallId}
      style={{ '--event-color': event.isError ? '#b24b4b' : meta.color } as React.CSSProperties}
    >
      <span className="event-time">
        <span>{clockLabel}</span>
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
                    onSelectEvent(event)
                    onOpenSubagent?.(event.subagent!, event.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      onSelectEvent(event)
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
    </div>
  )
})

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
  const causalLayout = useMemo(() => buildCausalLayout(allEvents), [allEvents])
  const selectedEvent = useMemo(
    () => allEvents.find((event) => event.id === selectedEventId),
    [allEvents, selectedEventId],
  )
  const highlightedCallId = selectedEvent?.toolCallId

  const onSelectEventRef = useRef(onSelectEvent)
  onSelectEventRef.current = onSelectEvent
  const stableSelectEvent = useCallback((event: TimelineEvent) => onSelectEventRef.current(event), [])

  const onOpenSubagentRef = useRef(onOpenSubagent)
  onOpenSubagentRef.current = onOpenSubagent
  const stableOpenSubagent = useCallback((subagent: SubagentReference, sourceEventId?: string) => {
    onOpenSubagentRef.current?.(subagent, sourceEventId)
  }, [])

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

  const visibleEventCount = useMemo(() => turns.reduce((count, turn) => count + turn.events.length, 0), [turns])
  const allSelected = allEventKinds.length > 0 && allEventKinds.every((kind) => enabledKinds.has(kind))

  const llmOutputBoundaries = useMemo(() => {
    const boundaries = new Map<string, LlmOutputBoundary>()
    for (const turn of turns) {
      for (const group of groupLlmOutputEvents(turn.events)) {
        if (!group.isLlmOutput) continue
        group.events.forEach((event, index) => {
          boundaries.set(event.id, {
            id: group.id,
            isStart: index === 0,
            isEnd: index === group.events.length - 1,
          })
        })
      }
    }
    return boundaries
  }, [turns])

  const timelineItems = useMemo<TimelineItem[]>(() => turns.flatMap((turn) => turn.events.map((event) => ({
    event,
    turnId: turn.id,
    llmOutputBoundary: llmOutputBoundaries.get(event.id),
  }))), [llmOutputBoundaries, turns])
  const groupCounts = useMemo(() => turns.map((turn) => turn.events.length), [turns])
  const timelineItemKey = useCallback((index: number) => timelineItems[index]?.event.id ?? index, [timelineItems])
  const eventIndexById = useMemo(() => new Map(timelineItems.map(({ event }, index) => [event.id, index])), [timelineItems])
  const clockLabels = useMemo(
    () => new Map(allEvents.map((event) => [event.id, formatClock(event.timestamp)])),
    [allEvents],
  )

  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const virtuosoRef = useRef<GroupedVirtuosoHandle>(null)
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null)
  const focusedEventIndexRef = useRef<number | null>(null)
  const pendingFocusEventIdRef = useRef<string | null>(null)
  const focusRequestRef = useRef(0)
  const setScrollContainer = useCallback((element: HTMLElement | Window | null) => {
    scrollContainerRef.current = element instanceof HTMLElement ? element : null
  }, [])

  const onFocusEvent = useCallback((index: number) => {
    focusRequestRef.current += 1
    pendingFocusEventIdRef.current = null
    focusedEventIndexRef.current = index
    setFocusedEventId(timelineItems[index]?.event.id ?? null)
    scrollContainerRef.current?.focus()
  }, [timelineItems])

  const focusEventAtIndex = useCallback((index: number) => {
    const item = timelineItems[index]
    if (!item) return

    focusedEventIndexRef.current = index
    pendingFocusEventIdRef.current = item.event.id
    setFocusedEventId(null)
    const request = ++focusRequestRef.current
    virtuosoRef.current?.scrollIntoView({
      index,
      behavior: 'auto',
      done: () => {
        if (focusRequestRef.current !== request) return
        pendingFocusEventIdRef.current = null
        setFocusedEventId(item.event.id)
      },
    })
  }, [timelineItems])

  const onMoveFocus = useCallback((direction: -1 | 1) => {
    const currentIndex = focusedEventIndexRef.current ?? 0
    const nextIndex = Math.max(0, Math.min(timelineItems.length - 1, currentIndex + direction))
    if (nextIndex !== currentIndex) focusEventAtIndex(nextIndex)
  }, [focusEventAtIndex, timelineItems.length])

  useEffect(() => {
    const focusedIndex = focusedEventId == null ? undefined : eventIndexById.get(focusedEventId)
    if ((focusedEventId != null && focusedIndex == null)
      || (pendingFocusEventIdRef.current != null && !eventIndexById.has(pendingFocusEventIdRef.current))) {
      focusRequestRef.current += 1
      pendingFocusEventIdRef.current = null
      focusedEventIndexRef.current = null
      setFocusedEventId(null)
      if (scrollContainerRef.current === document.activeElement && timelineItems.length > 0) {
        focusEventAtIndex(0)
      }
    } else if (focusedIndex != null) {
      focusedEventIndexRef.current = focusedIndex
    }
  }, [eventIndexById, focusEventAtIndex, focusedEventId, timelineItems.length])

  const onTimelineFocus = useCallback((focusEvent: React.FocusEvent<HTMLDivElement>) => {
    if (focusEvent.target === focusEvent.currentTarget && focusedEventIndexRef.current == null && timelineItems.length > 0) {
      focusEventAtIndex(0)
    }
  }, [focusEventAtIndex, timelineItems.length])

  const onTimelineKeyDown = useCallback((keyboardEvent: React.KeyboardEvent<HTMLDivElement>) => {
    if (keyboardEvent.key === 'ArrowUp' || keyboardEvent.key === 'ArrowDown') {
      keyboardEvent.preventDefault()
      onMoveFocus(keyboardEvent.key === 'ArrowUp' ? -1 : 1)
      return
    }

    if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
      keyboardEvent.preventDefault()
      const focusedIndex = focusedEventIndexRef.current ?? 0
      const item = timelineItems[focusedIndex]
      if (item) stableSelectEvent(item.event)
    }
  }, [onMoveFocus, stableSelectEvent, timelineItems])

  const focusedEventIndex = focusedEventId == null ? undefined : eventIndexById.get(focusedEventId)
  const focusedItem = focusedEventIndex == null ? undefined : timelineItems[focusedEventIndex]
  const focusedAnnouncement = focusedItem && focusedEventIndex != null
    ? t.timeline.keyboardAnnouncement(
      localizeTitle(focusedItem.event.title),
      focusedEventIndex + 1,
      timelineItems.length,
      selectedEvent ? localizeTitle(selectedEvent.title) : t.inspector.selectEvent,
    )
    : ''

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
      const index = eventIndexById.get(restorePosition.eventId)
      if (index != null) virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' })
    }
  }, [eventIndexById, restorePosition])

  return (
    <section className="timeline-panel" aria-label={t.timeline.ariaLabel}>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{focusedAnnouncement}</div>
      <div className="visually-hidden" id="timeline-keyboard-help">{t.timeline.keyboardInstructions}</div>
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

      {turns.length === 0 ? (
        <div className="timeline-empty">
          <Cog size={25} />
          <p>{enabledKinds.size === 0 ? t.timeline.emptyNoKinds : t.timeline.emptyNoEvents}</p>
        </div>
      ) : (
        <GroupedVirtuoso
          ref={virtuosoRef}
          className="timeline-scroll"
          role="listbox"
          aria-label={t.timeline.ariaLabel}
          aria-describedby="timeline-keyboard-help"
          aria-activedescendant={focusedEventId ? `event-row-${focusedEventId}` : undefined}
          tabIndex={0}
          onFocus={onTimelineFocus}
          onKeyDown={onTimelineKeyDown}
          style={{ flex: '1 1 0', minHeight: 0 }}
          components={timelineComponents}
          groupCounts={groupCounts}
          defaultItemHeight={68}
          overscan={{ main: 300, reverse: 300 }}
          scrollerRef={setScrollContainer}
          computeItemKey={timelineItemKey}
          groupContent={(groupIndex) => {
            const turn = turns[groupIndex]
            return (
              <header>
                <span>{localizeTitle(turn.label)}</span>
                <span>{t.timeline.turnEvents(turn.events.length)}</span>
              </header>
            )
          }}
          itemContent={(index) => {
            const item = timelineItems[index]
            if (!item) return null
            return (
              <EventRow
                event={item.event}
                index={index}
                eventCount={timelineItems.length}
                turnId={item.turnId}
                selected={selectedEventId === item.event.id}
                focused={focusedEventId === item.event.id}
                causal={causalLayout.byEventId.get(item.event.id) ?? { segments: [] }}
                maxLanes={causalLayout.maxLanes}
                highlightedCallId={highlightedCallId}
                mutedCallIds={mutedCallIds}
                clockLabel={clockLabels.get(item.event.id) ?? ''}
                llmOutputBoundary={item.llmOutputBoundary}
                onSelectEvent={stableSelectEvent}
                onFocusEvent={onFocusEvent}
                onOpenSubagent={stableOpenSubagent}
              />
            )
          }}
        />
      )}
    </section>
  )
}
