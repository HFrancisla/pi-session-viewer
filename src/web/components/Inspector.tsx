import { Boxes, Braces, ChevronDown, FileText, Info, Layers3, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatClock, formatDateTime, formatDuration } from '../../core/format'
import type { CapturedToolDefinition, SystemPromptComposition, TimelineEvent } from '../../core/types'
import { parseSystemPromptSections } from '../../core/prompt-sections'

interface InspectorProps {
  event: TimelineEvent | null
  mobileOpen: boolean
  onClose: () => void
}

type InspectorTab = 'overview' | 'content' | 'composition' | 'tools' | 'raw'
const CONTENT_LIMIT = 4_000

function ToolDefinitionsView({ tools }: { tools: CapturedToolDefinition[] }) {
  const [showFullJson, setShowFullJson] = useState(false)
  const jsonContent = JSON.stringify(tools, null, 2)
  const totalChars = jsonContent.length
  const totalTokens = Math.ceil(totalChars / 4)

  return (
    <div className="tool-definitions-view">
      <div className="tool-definitions-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="tool-definitions-count">共挂载 {tools.length} 个 API 工具能力</span>
          <button
            type="button"
            className="text-button"
            style={{ margin: 0, padding: '2px 8px', fontSize: '11px' }}
            onClick={() => setShowFullJson((v) => !v)}
          >
            {showFullJson ? '查看结构化卡片' : '查看完整 Schema (JSON)'}
          </button>
        </div>
        <span className="tool-definitions-tokens">
          定义大小约 {totalTokens.toLocaleString('zh-CN')} tokens（{totalChars.toLocaleString('zh-CN')} 字符，4字符/token估算）
        </span>
      </div>

      {showFullJson ? (
        <div className="content-view">
          <pre>{jsonContent}</pre>
        </div>
      ) : (
        tools.map((tool, index) => {
          const toolJson = JSON.stringify(tool, null, 2)
          const toolTokens = Math.ceil(toolJson.length / 4)

          return (
            <details className="prompt-block" key={tool.name} open>
              <summary>
                <ChevronDown size={14} className="prompt-block-arrow" aria-hidden="true" />
                <span className="prompt-block-title">
                  <span className="prompt-block-index">{index + 1}.</span>
                  <code>{tool.name}</code>
                </span>
                <span
                  className="prompt-block-meta"
                  title={`约 ${toolTokens.toLocaleString('zh-CN')} tokens (4字符/token估算)`}
                >
                  约 {toolTokens.toLocaleString('zh-CN')} tokens
                </span>
              </summary>
              <div className="tool-block-content">
                {tool.description && <div className="tool-block-desc">{tool.description}</div>}
                {tool.promptGuidelines && tool.promptGuidelines.length > 0 && (
                  <div className="tool-block-guidelines">
                    <div className="tool-schema-label">使用规范：</div>
                    <ul>
                      {tool.promptGuidelines.map((guideline, i) => (
                        <li key={i}>{guideline}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {tool.parameters ? (
                  <div className="tool-block-schema">
                    <div className="tool-schema-label">参数 JSON Schema:</div>
                    <pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
                  </div>
                ) : (
                  <div className="tool-block-empty">无参数 Schema 定义</div>
                )}
              </div>
            </details>
          )
        })
      )}
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
            <span
              className="prompt-block-meta"
              title={!item.isEmpty ? `约 ${item.estimatedTokens.toLocaleString('zh-CN')} tokens (4字符/token估算)` : undefined}
            >
              {item.meta}
            </span>
          </summary>
          <pre>{item.content}</pre>
        </details>
      ))}
    </div>
  )
}

export function Inspector({ event, mobileOpen, onClose }: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('content')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (event?.kind === 'tool-definitions') {
      setTab('tools')
    } else {
      setTab('content')
    }
    setExpanded(false)
  }, [event?.id])

  const tools = event?.toolDefinitions ?? []
  const hasComposition = event?.kind === 'system-prompt' || (event?.kind !== 'tool-definitions' && Boolean(event?.systemPrompt?.composition))
  const isToolDef = event?.kind === 'tool-definitions'
  const raw = event ? JSON.stringify(event.raw, null, 2) : ''
  const value = tab === 'raw' ? raw : tab === 'content' ? event?.content ?? '' : ''
  const isLong = value.length > CONTENT_LIMIT || value.split('\n').length > 40
  const shownValue = isLong && !expanded ? `${value.slice(0, CONTENT_LIMIT)}\n\n…其余内容已折叠` : value

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
            {isToolDef ? (
              <button type="button" role="tab" aria-selected={tab === 'tools'} onClick={() => setTab('tools')}>
                <Boxes size={15} />工具定义
              </button>
            ) : (
              <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>
                <FileText size={15} />内容
              </button>
            )}
            {hasComposition && (
              <button type="button" role="tab" aria-selected={tab === 'composition'} onClick={() => setTab('composition')}>
                <Layers3 size={15} />组成
              </button>
            )}
            <button type="button" role="tab" aria-selected={tab === 'raw'} onClick={() => setTab('raw')}>
              <Braces size={15} />Raw
            </button>
          </div>

          <div className="inspector-body">
            {tab === 'overview' ? (
              <dl className="event-facts">
                <div><dt>事件类型</dt><dd>{event.title}</dd></div>
                <div><dt>事件摘要</dt><dd>{event.summary}</dd></div>
                <div><dt>发生时刻</dt><dd>{formatClock(event.timestamp)}</dd></div>
                {event.durationMs != null && <div><dt>明确耗时</dt><dd>{formatDuration(event.durationMs)}</dd></div>}
                {event.kind === 'tool-definitions' && (
                  <>
                    <div><dt>工具总数</dt><dd>{(event.toolDefinitions?.length ?? 0)} 个 API 工具</dd></div>
                    <div><dt>估算消耗</dt><dd>约 {Math.ceil((event.content?.length ?? 0) / 4).toLocaleString('zh-CN')} tokens (4字符/token估算)</dd></div>
                    <div><dt>字符大小</dt><dd>{(event.content?.length ?? 0).toLocaleString('zh-CN')} 字符</dd></div>
                  </>
                )}
                {event.systemPrompt && event.kind !== 'tool-definitions' && <div><dt>捕获状态</dt><dd>{event.systemPrompt.recordType === 'missing' ? '未记录' : event.systemPrompt.recordType === 'snapshot' ? '完整快照' : '快照引用'}</dd></div>}
                {event.systemPrompt?.captureStage && event.kind !== 'tool-definitions' && <div><dt>捕获位置</dt><dd>{event.systemPrompt.captureStage === 'agent_start' ? '本轮初始请求' : '运行中 Prompt 更新'}</dd></div>}
                {event.systemPrompt?.promptLength != null && event.kind !== 'tool-definitions' && <div><dt>Prompt 长度</dt><dd>{event.systemPrompt.promptLength.toLocaleString('zh-CN')} 字符</dd></div>}
                {event.systemPrompt?.promptHash && event.kind !== 'tool-definitions' && <div><dt>内容哈希</dt><dd className="break-value">{event.systemPrompt.promptHash}</dd></div>}
                {event.systemPrompt?.sequence != null && event.kind !== 'tool-definitions' && <div><dt>会话序号</dt><dd>第 {event.systemPrompt.sequence} 次捕获</dd></div>}
                {event.systemPrompt?.capturedAt && <div><dt>捕获时间</dt><dd>{formatDateTime(event.systemPrompt.capturedAt)}</dd></div>}
                {event.systemPrompt?.model && <div><dt>模型</dt><dd>{event.systemPrompt.model.provider ?? '未知'} / {event.systemPrompt.model.id ?? '未知'}</dd></div>}
                {event.toolName && <div><dt>工具</dt><dd>{event.toolName}</dd></div>}
                {event.toolCallId && <div><dt>调用 ID</dt><dd className="break-value">{event.toolCallId}</dd></div>}
                {event.kind === 'tool-result' && <div><dt>结果状态</dt><dd className={event.isError ? 'status-error' : 'status-success'}>{event.isError ? '失败' : '成功'}</dd></div>}
                {event.pairedEventId && <div><dt>调用关联</dt><dd>已匹配</dd></div>}
                <div><dt>条目 ID</dt><dd className="break-value">{event.entryId}</dd></div>
              </dl>
            ) : tab === 'tools' ? (
              <ToolDefinitionsView tools={tools} />
            ) : tab === 'composition' && event ? (
              <PromptCompositionView
                key={event.id}
                prompt={event.content}
                composition={event.systemPrompt?.composition}
              />
            ) : (
              <div className="content-view">
                <pre>{shownValue || '此事件没有文本内容。'}</pre>
                {isLong && (
                  <button className="text-button" type="button" onClick={() => setExpanded((current) => !current)}>
                    {expanded ? '收起内容' : '显示全部内容'}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
