import {
  CornerDownRight,
  ChevronDown,
  Info,
  LocateFixed,
} from 'lucide-react'
import { useState } from 'react'
import { formatClock, formatDateTime, formatDuration } from '../../core/format'
import type { ToolDeclarationWithSource, TimelineEvent } from '../../core/types'
import { getToolProvenanceLabel, resolveToolProvenance, sanitizeToolForApi } from '../../core/tool-provenance'
import { PromptDiffView } from './PromptDiffView'
import { useI18n } from '../i18n'
import { CopyButton } from './CopyButton'
import { TabList, type TabOption } from './TabList'

interface InspectorProps {
  event: TimelineEvent | null
  onJumpToEvent: () => void
  /** Jumps the timeline to an entry this event is linked to by a context edit. */
  onJumpToEntry?: (entryId: string) => void
}

type InspectorTab = 'overview' | 'content' | 'composition' | 'diff' | 'raw'

/**
 * Jump to the other end of a context edit. The action lives here rather than on
 * the timeline row, because the row itself is a button and interactive controls
 * must not nest inside it.
 */
function ContextJumpButton({ entryId, label, disabled, onJump }: {
  entryId: string
  label: string
  disabled?: boolean
  onJump?: (entryId: string) => void
}) {
  if (!onJump) return null
  return (
    <button
      type="button"
      className="inspector-action-btn"
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={() => onJump(entryId)}
    >
      <CornerDownRight size={13} />
      <span>{label}</span>
    </button>
  )
}

function ToolDefinitionsView({ tools }: { tools: ToolDeclarationWithSource[] }) {
  const { t } = useI18n()

  return (
    <div className="tool-definitions-view">
      {tools.map((tool, index) => {
        const apiTool = sanitizeToolForApi(tool)
        const toolJson = JSON.stringify(apiTool, null, 2)
        const toolChars = toolJson.length
        const provenance = resolveToolProvenance(tool)
        const badgeLabel = getToolProvenanceLabel(provenance, t.inspector.toolProvenance)

        return (
          <details className="prompt-block" key={tool.name}>
            <summary>
              <ChevronDown size={14} className="prompt-block-arrow" aria-hidden="true" />
              <span className="prompt-block-title">
                <span className="prompt-block-index">{index + 1}.</span>
                <code>{tool.name}</code>
                <span
                  className={`tool-source-badge tool-source-badge--${provenance.kind}`}
                  title={provenance.displayPath ?? undefined}
                >
                  {badgeLabel}
                </span>
              </span>
              <span className="prompt-block-meta">
                {t.common.chars(toolChars)}
              </span>
            </summary>
            <div className="tool-block-expanded">
              <div className="content-body-wrap event--tool-definitions">
                <pre>{toolJson}</pre>
              </div>
            </div>
          </details>
        )
      })}
    </div>
  )
}

function PersistedStateView({ event }: { event: TimelineEvent }) {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const state = event.persistedState
  const message = state?.message
  const sections = message ? Object.entries(message.sections ?? {}) : []
  const tools = (message?.toolsAdded ?? []).map(tool => ({
    ...tool, sourceInfo: event.toolSources?.get(tool.name),
  }))
  const observation = event.observation
  return (
    <div className="prompt-composition">
      <p className="prompt-format-note">{zh ? '原生持久化状态，不代表最终 Provider 请求。' : 'Native persisted state, not the final Provider request.'}</p>
      {!message ? <p>{zh ? '持久化系统状态未知' : 'Persisted system state unknown'}</p> : <>
        <p>{zh ? '状态记录：' : 'State entry: '}<code>{state.entryId}</code></p>
        {message.content !== '' && <details className="prompt-block">
          <summary>{zh ? '原始内容' : 'Recorded content'}</summary>
          <div className="content-body-wrap event--system-prompt"><pre>{typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)}</pre></div>
        </details>}
        {sections.map(([name, content]) => <details className="prompt-block" key={name}>
          <summary><ChevronDown size={14} className="prompt-block-arrow" /><span className="prompt-block-title">{name}</span></summary>
          <div className="content-body-wrap event--system-prompt"><pre>{content}</pre></div>
        </details>)}
        {message.content === '' && sections.length === 0 && <p>{zh ? '明确记录的空提示词' : 'Explicitly recorded empty prompt'}</p>}
        <h3>{zh ? '原生工具声明' : 'Native tool declarations'} ({tools.length})</h3>
        <ToolDefinitionsView tools={tools} />
      </>}
      {event.toolDefinition && <><h3>{zh ? '配对调用的工具定义' : 'Invocation tool declaration'}</h3><ToolDefinitionsView tools={[event.toolDefinition]} /></>}
      <h3>{zh ? '补充观测' : 'Supplemental observation'}</h3>
      <p className="prompt-format-note">{zh ? '仅为 Harness 中间观测；未观测不代表没有覆盖。' : 'Intermediate Harness observation only; absence does not establish absence of an override.'}</p>
      {observation ? <>
        <p>Pi {observation.piVersion} · <code>{observation.anchorEntryId}</code> → <code>{observation.assistantEntryId}</code></p>
        {observation.forcedPrompt !== undefined && <>
          <h4>{zh ? '观测到的强制提示词' : 'Observed forced prompt'}</h4>
          {observation.forcedPrompt === '' ? <p>{zh ? '明确观测到空字符串' : 'Explicitly observed empty string'}</p> : <div className="content-body-wrap"><pre>{observation.forcedPrompt}</pre></div>}
        </>}
        {observation.toolSources && <div className="content-body-wrap"><pre>{JSON.stringify(observation.toolSources, null, 2)}</pre></div>}
      </> : <p>{zh ? '没有关联的补充观测' : 'No associated supplemental observation'}</p>}
    </div>
  )
}

function EventOverview({ event }: { event: TimelineEvent }) {
  const { t, localizeTitle } = useI18n()
  const totalChars = event.content?.length ?? 0
  const estimatedTokens = Math.ceil(totalChars / 4)
  const model = event.model
  const callProvenance = event.toolName ? resolveToolProvenance(event.toolDefinition, event.toolName) : undefined
  const callBadgeLabel = callProvenance ? getToolProvenanceLabel(callProvenance, t.inspector.toolProvenance) : ''

  return (
    <div className="inspector-overview">
      <div className="overview-section">
        <div className="overview-section-title">{t.inspector.sections.basicInfo}</div>
        <dl className="event-facts">
          <div><dt>{t.inspector.facts.eventType}</dt><dd><span className="overview-kind-badge">{localizeTitle(event.title)}</span></dd></div>
          <div><dt>{t.inspector.facts.timestamp}</dt><dd title={event.timestamp ? formatDateTime(event.timestamp) : undefined}>{formatClock(event.timestamp)}</dd></div>
          {event.gapMs != null && <div><dt>{t.inspector.facts.relativeGap}</dt><dd>+{formatDuration(event.gapMs)}</dd></div>}
          {event.durationMs != null && <div><dt>{t.inspector.facts.duration}</dt><dd>{formatDuration(event.durationMs)}</dd></div>}
          <div><dt>{t.inspector.facts.entryId}</dt><dd className="break-value"><code>{event.entryId}</code></dd></div>
        </dl>
      </div>

      <div className="overview-section">
        <div className="overview-section-title">{t.inspector.sections.specs}</div>
        <dl className="event-facts">
          <div><dt>{t.inspector.facts.contentLength}</dt><dd>{t.common.chars(totalChars)}</dd></div>
          <div><dt>{t.inspector.facts.estimatedTokens}</dt><dd>{t.common.tokensWithRate(estimatedTokens)}</dd></div>
        </dl>
      </div>

      {(event.toolName || event.toolCallId || event.kind === 'tool-result' || model) && (
        <div className="overview-section">
          <div className="overview-section-title">{t.inspector.sections.trace}</div>
          <dl className="event-facts">
            {model && (
              <div>
                <dt>{t.inspector.facts.model}</dt>
                <dd>{model.provider ?? t.inspector.facts.unknownProvider} / {model.id ?? t.inspector.facts.unknownModel}</dd>
              </div>
            )}
            {event.toolName && (
              <div>
                <dt>{t.inspector.facts.toolName}</dt>
                <dd className="tool-name-fact">
                  <code>{event.toolName}</code>
                  {callProvenance && (
                    <span
                      className={`tool-source-badge tool-source-badge--${callProvenance.kind}`}
                      title={callProvenance.displayPath ?? undefined}
                    >
                      {callBadgeLabel}
                    </span>
                  )}
                </dd>
              </div>
            )}
            {event.toolCallId && <div><dt>{t.inspector.facts.callId}</dt><dd className="break-value"><code>{event.toolCallId}</code></dd></div>}
            {event.kind === 'tool-result' && (
              <div>
                <dt>{t.inspector.facts.executionStatus}</dt>
                <dd className={event.isError ? 'status-error' : 'status-success'}>
                  {event.isError ? t.inspector.facts.statusFailure : t.inspector.facts.statusSuccess}
                </dd>
              </div>
            )}
            {event.pairedEventId && <div><dt>{t.inspector.facts.toolPairing}</dt><dd className="status-success">{t.inspector.facts.pairedSuccess}</dd></div>}
          </dl>
        </div>
      )}

    </div>
  )
}

function EventContentView({ event, onJumpToEntry }: { event: TimelineEvent; onJumpToEntry?: (entryId: string) => void }) {
  const { t } = useI18n()
  const content = event.content ?? ''
  const totalChars = content.length

  return (
    <div className="content-view">
      <div className="content-header-toolbar">
        <span className="content-header-tokens">
          {t.common.chars(totalChars)}
        </span>
        {event.contextEdit && (
          <ContextJumpButton
            entryId={event.contextEdit.targetEntryId}
            label={t.timeline.jumpToTarget}
            disabled={!event.contextEdit.targetOnBranch}
            onJump={onJumpToEntry}
          />
        )}
        {event.contextExclusion?.editId && (
          <ContextJumpButton
            entryId={event.contextExclusion.editId}
            label={t.timeline.jumpToRemovingEdit}
            onJump={onJumpToEntry}
          />
        )}
        <CopyButton text={content} />
      </div>

      <div
        className={`content-body-wrap event--${event.kind}${event.isError ? ' is-error' : ''}`}
      >
        <pre>{content || t.inspector.views.noContent}</pre>
      </div>
    </div>
  )
}

function EventRawView({ event }: { event: TimelineEvent }) {
  const { t } = useI18n()
  const rawText = JSON.stringify(event.raw, null, 2)

  return (
    <div className="content-view raw-view">
      <div className="content-header-toolbar">
        <span className="content-header-tokens">
          ID: <code>{event.entryId}</code>
        </span>
        <CopyButton text={rawText} />
      </div>

      <div
        className={`content-body-wrap event--${event.kind}${event.isError ? ' is-error' : ''}`}
      >
        <pre>{rawText || t.inspector.views.noRaw}</pre>
      </div>
    </div>
  )
}

export function Inspector({ event, onJumpToEvent, onJumpToEntry }: InspectorProps) {
  const { t, localizeTitle } = useI18n()
  const [tab, setTab] = useState<InspectorTab>('content')
  const tabs: TabOption<InspectorTab>[] = [
    { value: 'overview', label: t.inspector.tabs.overview },
    { value: 'composition', label: t.inspector.tabs.composition },
    { value: 'content', label: t.inspector.tabs.content },
    { value: 'diff', label: t.inspector.tabs.diff },
    { value: 'raw', label: t.inspector.tabs.raw },
  ]
  const activeTab = tabs.some((item) => item.value === tab) ? tab : 'content'

  return (
    <aside
      className="inspector"
      aria-label={t.inspector.heading}
    >
      <div className="inspector-heading">
        <div>
          <h2>{t.inspector.heading}</h2>
          <p>{event ? localizeTitle(event.title) : t.inspector.selectEvent}</p>
        </div>
        <div className="inspector-heading-actions">
          {event && (
            <button className="icon-button" type="button" onClick={onJumpToEvent} title={t.inspector.jumpToEvent} aria-label={t.inspector.jumpToEvent}>
              <LocateFixed size={16} />
            </button>
          )}
        </div>
      </div>

      {!event ? (
        <div className="inspector-empty">
          <Info size={24} />
          <p>{t.inspector.emptyHint}</p>
        </div>
      ) : (
        <>
          <TabList items={tabs} value={activeTab} onChange={setTab} label={t.inspector.heading} idPrefix="inspector-tab" panelId="inspector-tabpanel" />

          <div className="inspector-body" role="tabpanel" id="inspector-tabpanel" aria-labelledby={`inspector-tab-${activeTab}`} tabIndex={0}>
            {activeTab === 'overview' ? (
              <EventOverview event={event} />
            ) : activeTab === 'composition' && event ? (
              <PersistedStateView key={event.id} event={event} />
            ) : activeTab === 'diff' && event ? (
              <PromptDiffView key={event.id} event={event} />
            ) : activeTab === 'raw' ? (
              <EventRawView event={event} />
            ) : (
              <EventContentView event={event} onJumpToEntry={onJumpToEntry} />
            )}
          </div>
        </>
      )}
    </aside>
  )
}
