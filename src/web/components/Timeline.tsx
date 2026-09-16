import { AlertTriangle, Bot, Brain, CheckCircle2, ChevronDown, CircleUserRound, Cog, ScrollText, Wrench, XCircle } from 'lucide-react'
import type { ComponentType } from 'react'
import { buildCausalLayout, causalLaneX, type CausalEventLayout } from '../../core/causal-layout'
import { allEventKinds } from '../../core/event-kinds'
import { formatClock, formatDuration } from '../../core/format'
import type { EventKind, ParsedSession, TimelineEvent, TimelineTurn } from '../../core/types'

const kindMeta: Record<EventKind, { label: string; icon: ComponentType<{ size?: number; className?: string }>; color: string }> = {
  'system-prompt': { label: '系统提示词', icon: ScrollText, color: '#8a4f68' },
  user: { label: '用户', icon: CircleUserRound, color: '#485c66' },
  assistant: { label: 'Pi 回复', icon: Bot, color: '#246b83' },
  thinking: { label: 'Thinking', icon: Brain, color: '#765a9a' },
  'tool-call': { label: '工具调用', icon: Wrench, color: '#a66a18' },
  'tool-result': { label: '工具结果', icon: CheckCircle2, color: '#2f7d57' },
  system: { label: '系统', icon: Cog, color: '#66716d' },
}

interface TimelineProps {
  session: ParsedSession
  turns: TimelineTurn[]
  allEvents: TimelineEvent[]
  selectedEventId: string | null
  selectedLeafId: string | null
  enabledKinds: Set<EventKind>
  onSelectEvent: (event: TimelineEvent) => void
  onSelectBranch: (leafId: string) => void
  onToggleKind: (kind: EventKind) => void
}

interface LlmOutputGroup {
  id: string
  events: TimelineEvent[]
  isLlmOutput: boolean
  totalBlocks: number
}

function isLlmOutputEvent(event: TimelineEvent): boolean {
  return event.kind === 'assistant' || event.kind === 'thinking' || event.kind === 'tool-call'
}

function groupLlmOutputEvents(events: TimelineEvent[], blockCounts: Map<string, number>): LlmOutputGroup[] {
  const groups: LlmOutputGroup[] = []
  for (const event of events) {
    const totalBlocks = blockCounts.get(event.entryId) ?? 0
    const shouldGroup = isLlmOutputEvent(event) && totalBlocks > 1
    const previous = groups.at(-1)
    if (shouldGroup && previous?.isLlmOutput && previous.id === event.entryId) {
      previous.events.push(event)
    } else {
      groups.push({
        id: shouldGroup ? event.entryId : event.id,
        events: [event],
        isLlmOutput: shouldGroup,
        totalBlocks,
      })
    }
  }
  return groups
}

function EventRow({ event, selected, causal, maxLanes, highlightedCallId, onSelect }: {
  event: TimelineEvent
  selected: boolean
  causal: CausalEventLayout
  maxLanes: number
  highlightedCallId?: string
  onSelect: () => void
}) {
  const meta = kindMeta[event.kind]
  const Icon = event.kind === 'tool-result' && event.isError ? XCircle : meta.icon
  const isPairRelated = Boolean(highlightedCallId && event.toolCallId === highlightedCallId)

  return (
    <button
      className={`event-row event--${event.kind}${selected ? ' is-selected' : ''}${isPairRelated ? ' is-pair-related' : ''}`}
      type="button"
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
        {causal.segments.map((segment) => (
          <span
            className={`causal-rail causal-rail--${segment.phase}${highlightedCallId === segment.callId ? ' is-highlighted' : ''}${highlightedCallId && highlightedCallId !== segment.callId ? ' is-muted' : ''}`}
            data-call-id={segment.callId}
            key={segment.callId}
            style={{ '--lane-x': `${causalLaneX(segment.lane, maxLanes)}px` } as React.CSSProperties}
          />
        ))}
      </span>
      <span className="event-copy">
        <span className="event-title-line">
          <strong>{event.title}</strong>
          {causal.eventLane != null && <span className="lane-label">#{causal.eventLane + 1}</span>}
          {event.kind === 'tool-result' && (
            <span className={`event-status ${event.isError ? 'is-error' : 'is-success'}`}>{event.isError ? '失败' : '成功'}</span>
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
  selectedLeafId,
  enabledKinds,
  onSelectEvent,
  onSelectBranch,
  onToggleKind,
}: TimelineProps) {
  const causalLayout = buildCausalLayout(allEvents)
  const selectedEvent = allEvents.find((event) => event.id === selectedEventId)
  const highlightedCallId = selectedEvent?.toolCallId
  const llmBlockCounts = new Map<string, number>()
  for (const event of allEvents) {
    if (isLlmOutputEvent(event)) {
      llmBlockCounts.set(event.entryId, (llmBlockCounts.get(event.entryId) ?? 0) + 1)
    }
  }
  const visibleEventCount = turns.reduce((count, turn) => count + turn.events.length, 0)

  return (
    <section className="timeline-panel" aria-label="会话时间轴">
      <div className="filter-bar">
        <span className="filter-label">显示</span>
        <div className="filter-options">
          {allEventKinds.map((kind) => {
            const FilterIcon = kindMeta[kind].icon
            return (
              <label key={kind} style={{ '--filter-color': kindMeta[kind].color } as React.CSSProperties}>
                <input type="checkbox" checked={enabledKinds.has(kind)} onChange={() => onToggleKind(kind)} />
                <FilterIcon className="filter-kind-icon" size={13} />
                {kindMeta[kind].label}
              </label>
            )
          })}
        </div>
      </div>

      {session.warnings.length > 0 && (
        <details className="warning-strip">
          <summary><AlertTriangle size={16} />{session.warnings.length} 条解析警告<ChevronDown size={15} /></summary>
          <ul>
            {session.warnings.map((warning, index) => <li key={`${warning.code}-${warning.line ?? index}`}>{warning.message}</li>)}
          </ul>
        </details>
      )}

      <div className="branch-bar">
        <label htmlFor="branch-select">路径</label>
        <select id="branch-select" value={selectedLeafId ?? ''} onChange={(event) => onSelectBranch(event.target.value)}>
          {session.branches.map((branch) => (
            <option key={branch.leafId} value={branch.leafId}>{branch.label}</option>
          ))}
        </select>
        <span>{visibleEventCount} 个可见事件</span>
      </div>

      <div className="timeline-scroll">
        {turns.length === 0 ? (
          <div className="timeline-empty">
            <Cog size={25} />
            <p>{enabledKinds.size === 0 ? '至少选择一种事件类型。' : '当前路径没有可显示的事件。'}</p>
          </div>
        ) : turns.map((turn) => (
          <section className="turn-group" key={turn.id}>
            <header>
              <span>{turn.label}</span>
              <span>{turn.events.length} 个事件</span>
            </header>
            <div className="turn-events">
              {groupLlmOutputEvents(turn.events, llmBlockCounts).map((group) => {
                const rows = group.events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    selected={selectedEventId === event.id}
                    causal={causalLayout.byEventId.get(event.id) ?? { segments: [] }}
                    maxLanes={causalLayout.maxLanes}
                    highlightedCallId={highlightedCallId}
                    onSelect={() => onSelectEvent(event)}
                  />
                ))
                if (!group.isLlmOutput) return rows
                return (
                  <section className="llm-output-group" key={group.id} aria-label="一轮 LLM 输出">
                    <header className="llm-output-header">
                      <Bot size={13} />
                      <span>LLM 输出</span>
                      <small>{group.totalBlocks} 个内容块</small>
                    </header>
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
