import {
  Braces,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Info,
  Layers3,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatClock, formatDateTime, formatDuration } from '../../core/format'
import type { CapturedToolDefinition, SystemPromptComposition, TimelineEvent } from '../../core/types'
import { parseSystemPromptSections } from '../../core/prompt-sections'

interface InspectorProps {
  event: TimelineEvent | null
  mobileOpen: boolean
  onClose: () => void
}

type InspectorTab = 'overview' | 'content' | 'composition' | 'raw'

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

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
      title={copied ? '已复制到剪贴板' : label}
      aria-label={copied ? '已复制到剪贴板' : label}
    >
      {copied ? <Check size={13} className="copy-success-icon" /> : <Copy size={13} />}
      <span>{copied ? '已复制' : label}</span>
    </button>
  )
}

function ToolDefinitionsView({ tools }: { tools: CapturedToolDefinition[] }) {
  return (
    <div className="tool-definitions-view">
      {tools.map((tool, index) => {
        const toolJson = JSON.stringify(tool, null, 2)
        const toolChars = toolJson.length

        return (
          <details className="prompt-block" key={tool.name}>
            <summary>
              <ChevronDown size={14} className="prompt-block-arrow" aria-hidden="true" />
              <span className="prompt-block-title">
                <span className="prompt-block-index">{index + 1}.</span>
                <code>{tool.name}</code>
              </span>
              <span className="prompt-block-meta">
                {toolChars.toLocaleString('zh-CN')} 字符
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
  const sections = parseSystemPromptSections(prompt, composition)

  return (
    <div className="prompt-composition">
      {sections.items.map((item) => (
        <details className="prompt-block" key={item.id}>
          <summary>
            <ChevronDown size={14} className="prompt-block-arrow" aria-hidden="true" />
            <span className="prompt-block-title">
              <span className="prompt-block-index">{item.index}.</span>
              {item.title}
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
  const totalChars = event.content?.length ?? 0
  const estimatedTokens = Math.ceil(totalChars / 4)
  const isToolDef = event.kind === 'tool-definitions'
  const model = event.model || event.systemPrompt?.model

  return (
    <div className="inspector-overview">
      <div className="overview-section">
        <div className="overview-section-title">基本信息</div>
        <dl className="event-facts">
          <div><dt>事件类型</dt><dd><span className="overview-kind-badge">{event.title}</span></dd></div>
          <div><dt>发生时刻</dt><dd title={event.timestamp ? formatDateTime(event.timestamp) : undefined}>{formatClock(event.timestamp)}</dd></div>
          {event.gapMs != null && <div><dt>相对间隔</dt><dd>+{formatDuration(event.gapMs)}</dd></div>}
          {event.durationMs != null && <div><dt>明确耗时</dt><dd>{formatDuration(event.durationMs)}</dd></div>}
          <div><dt>所属条目 ID</dt><dd className="break-value"><code>{event.entryId}</code></dd></div>
        </dl>
      </div>

      <div className="overview-section">
        <div className="overview-section-title">规格与开销</div>
        <dl className="event-facts">
          {isToolDef ? (
            <>
              <div><dt>挂载工具</dt><dd>{event.toolDefinitions?.length ?? 0} 个 API 工具</dd></div>
              <div><dt>Schema 大小</dt><dd>{totalChars.toLocaleString('zh-CN')} 字符</dd></div>
              <div><dt>估算消耗</dt><dd>约 {estimatedTokens.toLocaleString('zh-CN')} tokens</dd></div>
            </>
          ) : (
            <>
              <div><dt>内容字数</dt><dd>{totalChars.toLocaleString('zh-CN')} 字符</dd></div>
              <div><dt>估算消耗</dt><dd>约 {estimatedTokens.toLocaleString('zh-CN')} tokens (4字符/token)</dd></div>
            </>
          )}
        </dl>
      </div>

      {(event.toolName || event.toolCallId || event.kind === 'tool-result' || model) && (
        <div className="overview-section">
          <div className="overview-section-title">链路与模型</div>
          <dl className="event-facts">
            {model && (
              <div>
                <dt>运行模型</dt>
                <dd>{model.provider ?? '未知提供方'} / {model.id ?? '未知模型'}</dd>
              </div>
            )}
            {event.toolName && <div><dt>工具名称</dt><dd><code>{event.toolName}</code></dd></div>}
            {event.toolCallId && <div><dt>调用 ID</dt><dd className="break-value"><code>{event.toolCallId}</code></dd></div>}
            {event.kind === 'tool-result' && (
              <div>
                <dt>执行状态</dt>
                <dd className={event.isError ? 'status-error' : 'status-success'}>
                  {event.isError ? '执行失败' : '执行成功'}
                </dd>
              </div>
            )}
            {event.pairedEventId && <div><dt>调用配对</dt><dd className="status-success">已关联对应事件</dd></div>}
          </dl>
        </div>
      )}

      {event.systemPrompt && !isToolDef && (
        <div className="overview-section">
          <div className="overview-section-title">提示词快照</div>
          <dl className="event-facts">
            <div><dt>快照状态</dt><dd>{event.systemPrompt.recordType === 'missing' ? '未记录' : event.systemPrompt.recordType === 'snapshot' ? '完整快照' : '快照引用'}</dd></div>
            {event.systemPrompt.captureStage && <div><dt>捕获位置</dt><dd>{event.systemPrompt.captureStage === 'agent_start' ? '本轮初始请求' : '运行中 Prompt 更新'}</dd></div>}
            {event.systemPrompt.promptLength != null && <div><dt>Prompt 长度</dt><dd>{event.systemPrompt.promptLength.toLocaleString('zh-CN')} 字符</dd></div>}
            {event.systemPrompt.promptHash && <div><dt>内容哈希</dt><dd className="break-value"><code>{event.systemPrompt.promptHash}</code></dd></div>}
            {event.systemPrompt.sequence != null && <div><dt>会话序号</dt><dd>第 {event.systemPrompt.sequence} 次捕获</dd></div>}
            {event.systemPrompt.capturedAt && <div><dt>捕获时间</dt><dd>{formatDateTime(event.systemPrompt.capturedAt)}</dd></div>}
          </dl>
        </div>
      )}
    </div>
  )
}

function EventContentView({ event }: { event: TimelineEvent }) {
  const content = event.content ?? ''
  const totalChars = content.length

  return (
    <div className="content-view">
      <div className="content-header-toolbar">
        <span className="content-header-tokens">
          {totalChars.toLocaleString('zh-CN')} 字符
        </span>
        <CopyButton text={content} label="复制" />
      </div>

      <div
        className={`content-body-wrap event--${event.kind}${event.isError ? ' is-error' : ''}`}
      >
        <pre>{content || '此事件没有文本内容。'}</pre>
      </div>
    </div>
  )
}

function EventRawView({ event }: { event: TimelineEvent }) {
  const rawText = JSON.stringify(event.raw, null, 2)

  return (
    <div className="content-view raw-view">
      <div className="content-header-toolbar">
        <span className="content-header-tokens">
          ID: <code>{event.entryId}</code>
        </span>
        <CopyButton text={rawText} label="复制" />
      </div>

      <div
        className={`content-body-wrap event--${event.kind}${event.isError ? ' is-error' : ''}`}
      >
        <pre>{rawText || '无原始数据'}</pre>
      </div>
    </div>
  )
}

export function Inspector({ event, mobileOpen, onClose }: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('content')

  useEffect(() => {
    setTab('content')
  }, [event?.id])

  const tools = event?.toolDefinitions ?? []
  const hasComposition = event?.kind === 'system-prompt' || (event?.kind !== 'tool-definitions' && Boolean(event?.systemPrompt?.composition))
  const isToolDef = event?.kind === 'tool-definitions'

  return (
    <aside className={`inspector${mobileOpen ? ' is-mobile-open' : ''}`} aria-label="事件详情">
      <div className="inspector-heading">
        <div>
          <h2>详情</h2>
          <p>{event?.title ?? '选择一个事件'}</p>
        </div>
        <button className="icon-button inspector-close" type="button" onClick={onClose} title="关闭详情" aria-label="关闭详情">
          <X size={18} />
        </button>
      </div>

      {!event ? (
        <div className="inspector-empty">
          <Info size={24} />
          <p>从时间轴选择事件，查看内容和原始记录。</p>
        </div>
      ) : (
        <>
          <div className="inspector-tabs" role="tablist" aria-label="详情视图">
            <button type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
              <Info size={15} />概览
            </button>
            {hasComposition && (
              <button type="button" role="tab" aria-selected={tab === 'composition'} onClick={() => setTab('composition')}>
                <Layers3 size={15} />组成
              </button>
            )}
            <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>
              <FileText size={15} />内容
            </button>
            <button type="button" role="tab" aria-selected={tab === 'raw'} onClick={() => setTab('raw')}>
              <Braces size={15} />Raw
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
