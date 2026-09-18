import {
  Braces,
  Check,
  ChevronDown,
  Copy,
  FileText,
  GitCompare,
  Info,
  Layers3,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatClock, formatDateTime, formatDuration } from '../../core/format'
import type { CapturedToolDefinition, SystemPromptComposition, TimelineEvent } from '../../core/types'
import { parseSystemPromptSections } from '../../core/prompt-sections'
import { getToolProvenanceLabel, resolveToolProvenance, sanitizeToolForApi } from '../../core/tool-provenance'
import { PromptDiffView } from './PromptDiffView'
import { useI18n } from '../i18n'

interface InspectorProps {
  event: TimelineEvent | null
  mobileOpen: boolean
  onClose: () => void
}

type InspectorTab = 'overview' | 'content' | 'composition' | 'diff' | 'raw'

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const displayLabel = label ?? t.common.copy

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard permission error
    }
  }

  return (
    <button
      type="button"
      className="inspector-action-btn"
      onClick={handleCopy}
      title={copied ? t.common.copiedTooltip : displayLabel}
      aria-label={copied ? t.common.copiedTooltip : displayLabel}
    >
      {copied ? <Check size={13} className="copy-success-icon" /> : <Copy size={13} />}
      <span>{copied ? t.common.copied : displayLabel}</span>
    </button>
  )
}

function ToolDefinitionsView({ tools }: { tools: CapturedToolDefinition[] }) {
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

function PromptCompositionView({ prompt, composition }: {
  prompt: string
  composition?: SystemPromptComposition
}) {
  const { localizeTitle } = useI18n()
  const sections = parseSystemPromptSections(prompt, composition)

  return (
    <div className="prompt-composition">
      {sections.items.map((item) => (
        <details className="prompt-block" key={item.id}>
          <summary>
            <ChevronDown size={14} className="prompt-block-arrow" aria-hidden="true" />
            <span className="prompt-block-title">
              <span className="prompt-block-index">{item.index}.</span>
              {localizeTitle(item.title)}
            </span>
            <span className="prompt-block-meta">
              {item.meta}
            </span>
          </summary>
          <div className="prompt-block-expanded">
            <div className="content-body-wrap event--system-prompt">
              <pre>{item.content}</pre>
            </div>
          </div>
        </details>
      ))}
    </div>
  )
}

function EventOverview({ event }: { event: TimelineEvent }) {
  const { t, localizeTitle } = useI18n()
  const totalChars = event.content?.length ?? 0
  const estimatedTokens = Math.ceil(totalChars / 4)
  const isToolDef = event.kind === 'tool-definitions'
  const model = event.model || event.systemPrompt?.model
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
          {isToolDef ? (
            <>
              <div><dt>{t.inspector.facts.mountedTools}</dt><dd>{t.inspector.facts.mountedToolsCount(event.toolDefinitions?.length ?? 0)}</dd></div>
              <div><dt>{t.inspector.facts.schemaSize}</dt><dd>{t.common.chars(totalChars)}</dd></div>
              <div><dt>{t.inspector.facts.estimatedTokens}</dt><dd>{t.common.tokens(estimatedTokens)}</dd></div>
            </>
          ) : (
            <>
              <div><dt>{t.inspector.facts.contentLength}</dt><dd>{t.common.chars(totalChars)}</dd></div>
              <div><dt>{t.inspector.facts.estimatedTokens}</dt><dd>{t.common.tokensWithRate(estimatedTokens)}</dd></div>
            </>
          )}
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

      {event.systemPrompt && !isToolDef && (
        <div className="overview-section">
          <div className="overview-section-title">{t.inspector.sections.promptSnapshot}</div>
          <dl className="event-facts">
            <div><dt>{t.inspector.facts.snapshotStatus}</dt><dd>{event.systemPrompt.recordType === 'missing' ? t.inspector.facts.recordTypeMissing : event.systemPrompt.recordType === 'snapshot' ? t.inspector.facts.recordTypeSnapshot : t.inspector.facts.recordTypeReference}</dd></div>
            {event.systemPrompt.captureStage && <div><dt>{t.inspector.facts.captureStage}</dt><dd>{event.systemPrompt.captureStage === 'agent_start' ? t.inspector.facts.stageAgentStart : t.inspector.facts.stageRequestUpdate}</dd></div>}
            {event.systemPrompt.promptLength != null && <div><dt>{t.inspector.facts.promptLength}</dt><dd>{t.common.chars(event.systemPrompt.promptLength)}</dd></div>}
            {event.systemPrompt.promptHash && <div><dt>{t.inspector.facts.contentHash}</dt><dd className="break-value"><code>{event.systemPrompt.promptHash}</code></dd></div>}
            {event.systemPrompt.sequence != null && <div><dt>{t.inspector.facts.sequence}</dt><dd>{t.inspector.facts.sequenceFormat(event.systemPrompt.sequence)}</dd></div>}
            {event.systemPrompt.capturedAt && <div><dt>{t.inspector.facts.capturedAt}</dt><dd>{formatDateTime(event.systemPrompt.capturedAt)}</dd></div>}
          </dl>
        </div>
      )}
    </div>
  )
}

function EventContentView({ event }: { event: TimelineEvent }) {
  const { t } = useI18n()
  const content = event.content ?? ''
  const totalChars = content.length

  return (
    <div className="content-view">
      <div className="content-header-toolbar">
        <span className="content-header-tokens">
          {t.common.chars(totalChars)}
        </span>
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

export function Inspector({ event, mobileOpen, onClose }: InspectorProps) {
  const { t, localizeTitle } = useI18n()
  const [tab, setTab] = useState<InspectorTab>('content')

  useEffect(() => {
    setTab('content')
  }, [event?.id])

  const tools = event?.toolDefinitions ?? []
  const isSystemPrompt = event?.kind === 'system-prompt'
  const hasComposition = isSystemPrompt || (event?.kind !== 'tool-definitions' && Boolean(event?.systemPrompt?.composition))
  const isToolDef = event?.kind === 'tool-definitions'

  return (
    <aside className={`inspector${mobileOpen ? ' is-mobile-open' : ''}`} aria-label={t.inspector.heading}>
      <div className="inspector-heading">
        <div>
          <h2>{t.inspector.heading}</h2>
          <p>{event ? localizeTitle(event.title) : t.inspector.selectEvent}</p>
        </div>
        <button className="icon-button inspector-close" type="button" onClick={onClose} title={t.header.closeInspector} aria-label={t.header.closeInspector}>
          <X size={18} />
        </button>
      </div>

      {!event ? (
        <div className="inspector-empty">
          <Info size={24} />
          <p>{t.inspector.emptyHint}</p>
        </div>
      ) : (
        <>
          <div className="inspector-tabs" role="tablist" aria-label={t.inspector.heading}>
            <button type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
              <Info size={15} />{t.inspector.tabs.overview}
            </button>
            {hasComposition && (
              <button type="button" role="tab" aria-selected={tab === 'composition'} onClick={() => setTab('composition')}>
                <Layers3 size={15} />{t.inspector.tabs.composition}
              </button>
            )}
            <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>
              <FileText size={15} />{t.inspector.tabs.content}
            </button>
            {isSystemPrompt && (
              <button type="button" role="tab" aria-selected={tab === 'diff'} onClick={() => setTab('diff')}>
                <GitCompare size={15} />{t.inspector.tabs.diff}
              </button>
            )}
            <button type="button" role="tab" aria-selected={tab === 'raw'} onClick={() => setTab('raw')}>
              <Braces size={15} />{t.inspector.tabs.raw}
            </button>
          </div>

          <div className="inspector-body">
            {tab === 'overview' ? (
              <EventOverview event={event} />
            ) : tab === 'composition' && event ? (
              <PromptCompositionView
                key={event.id}
                prompt={event.content}
                composition={event.systemPrompt?.composition}
              />
            ) : tab === 'diff' && event ? (
              <PromptDiffView key={event.id} event={event} />
            ) : tab === 'raw' ? (
              <EventRawView event={event} />
            ) : isToolDef ? (
              <ToolDefinitionsView tools={tools} />
            ) : (
              <EventContentView event={event} />
            )}
          </div>
        </>
      )}
    </aside>
  )
}
