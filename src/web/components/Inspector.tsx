import { Braces, FileText, Info, Layers3, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatClock, formatDateTime, formatDuration } from '../../core/format'
import type { SystemPromptComposition, TimelineEvent } from '../../core/types'

interface InspectorProps {
  event: TimelineEvent | null
  mobileOpen: boolean
  onClose: () => void
}

type InspectorTab = 'overview' | 'content' | 'composition' | 'raw'
const CONTENT_LIMIT = 4_000

function PromptCompositionView({ composition, promptBeforeFinalExtensions }: {
  composition: SystemPromptComposition
  promptBeforeFinalExtensions?: string
}) {
  const toolEntries = Object.entries(composition.toolSnippets)
  return (
    <div className="prompt-composition">
      <ol className="composition-order" aria-label="系统提示词拼接顺序">
        <li>基础模板</li>
        <li>工具与规则</li>
        <li>追加指令</li>
        <li>项目上下文</li>
        <li>Skills</li>
        <li>工作目录</li>
        <li>扩展修改</li>
      </ol>

      <details className="prompt-block" open>
        <summary>基础模板</summary>
        <pre>{composition.customPrompt ?? '使用 Pi 默认基础模板；最终展开文本请查看“内容”标签。'}</pre>
      </details>

      <details className="prompt-block" open>
        <summary>工具与规则 <span>{composition.selectedTools.length} 个工具</span></summary>
        <div className="prompt-block-body">
          <p className="prompt-subheading">激活工具</p>
          <ul>{composition.selectedTools.map((tool) => <li key={tool}><code>{tool}</code></li>)}</ul>
          {toolEntries.length > 0 && (
            <>
              <p className="prompt-subheading">工具摘要</p>
              <dl className="prompt-key-values">
                {toolEntries.map(([name, snippet]) => <div key={name}><dt>{name}</dt><dd>{snippet}</dd></div>)}
              </dl>
            </>
          )}
          {composition.promptGuidelines.length > 0 && (
            <>
              <p className="prompt-subheading">附加规则</p>
              <ul>{composition.promptGuidelines.map((guideline, index) => <li key={`${index}-${guideline}`}>{guideline}</li>)}</ul>
            </>
          )}
        </div>
      </details>

      <details className="prompt-block" open={Boolean(composition.appendSystemPrompt)}>
        <summary>追加指令 <span>{composition.appendSystemPrompt ? '有内容' : '无'}</span></summary>
        <pre>{composition.appendSystemPrompt || '本轮没有 appendSystemPrompt。'}</pre>
      </details>

      <details className="prompt-block" open={composition.contextFiles.length > 0}>
        <summary>项目上下文 <span>{composition.contextFiles.length} 个文件</span></summary>
        <div className="prompt-block-body">
          {composition.contextFiles.length === 0 ? <p>本轮没有加载 context file。</p> : composition.contextFiles.map((file) => (
            <details className="prompt-source-file" key={file.path}>
              <summary>{file.path}</summary>
              <pre>{file.content}</pre>
            </details>
          ))}
        </div>
      </details>

      <details className="prompt-block" open={composition.skills.length > 0}>
        <summary>Skills <span>{composition.skills.length} 个</span></summary>
        <div className="prompt-block-body">
          {composition.skills.length === 0 ? <p>本轮没有向模型公开 skill。</p> : (
            <dl className="prompt-key-values">
              {composition.skills.map((skill) => (
                <div key={skill.filePath || skill.name}>
                  <dt>{skill.name}</dt>
                  <dd>{skill.description}<code>{skill.filePath}</code></dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </details>

      <details className="prompt-block" open>
        <summary>工作目录</summary>
        <pre>{composition.cwd || '未记录'}</pre>
      </details>

      <details className="prompt-block" open={Boolean(promptBeforeFinalExtensions)}>
        <summary>扩展修改 <span>{promptBeforeFinalExtensions ? '检测到变化' : '未检测到变化'}</span></summary>
        <pre>{promptBeforeFinalExtensions ?? '捕获点与最终有效系统提示词一致。'}</pre>
      </details>
    </div>
  )
}

export function Inspector({ event, mobileOpen, onClose }: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('content')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setTab('content')
    setExpanded(false)
  }, [event?.id])

  const hasComposition = Boolean(event?.systemPrompt?.composition)
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
          <div className={`inspector-tabs${hasComposition ? ' has-composition' : ''}`} role="tablist" aria-label="详情视图">
            <button type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
              <Info size={15} />概览
            </button>
            <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>
              <FileText size={15} />内容
            </button>
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
                <div><dt>事件类型</dt><dd>{event.kind}</dd></div>
                <div><dt>发生时刻</dt><dd>{formatClock(event.timestamp)}</dd></div>
                {event.durationMs != null && <div><dt>明确耗时</dt><dd>{formatDuration(event.durationMs)}</dd></div>}
                {event.systemPrompt && <div><dt>捕获状态</dt><dd>{event.systemPrompt.recordType === 'missing' ? '未记录' : event.systemPrompt.recordType === 'snapshot' ? '完整快照' : '快照引用'}</dd></div>}
                {event.systemPrompt?.captureStage && <div><dt>捕获位置</dt><dd>{event.systemPrompt.captureStage === 'agent_start' ? '本轮初始请求' : '运行中 Prompt 更新'}</dd></div>}
                {event.systemPrompt?.promptLength != null && <div><dt>Prompt 长度</dt><dd>{event.systemPrompt.promptLength.toLocaleString('zh-CN')} 字符</dd></div>}
                {event.systemPrompt?.promptHash && <div><dt>内容哈希</dt><dd className="break-value">{event.systemPrompt.promptHash}</dd></div>}
                {event.systemPrompt?.sequence != null && <div><dt>会话序号</dt><dd>第 {event.systemPrompt.sequence} 次捕获</dd></div>}
                {event.systemPrompt?.capturedAt && <div><dt>捕获时间</dt><dd>{formatDateTime(event.systemPrompt.capturedAt)}</dd></div>}
                {event.systemPrompt?.model && <div><dt>模型</dt><dd>{event.systemPrompt.model.provider ?? '未知'} / {event.systemPrompt.model.id ?? '未知'}</dd></div>}
                {event.toolName && <div><dt>工具</dt><dd>{event.toolName}</dd></div>}
                {event.toolCallId && <div><dt>调用 ID</dt><dd className="break-value">{event.toolCallId}</dd></div>}
                {event.kind === 'tool-result' && <div><dt>结果状态</dt><dd className={event.isError ? 'status-error' : 'status-success'}>{event.isError ? '失败' : '成功'}</dd></div>}
                {event.pairedEventId && <div><dt>调用关联</dt><dd>已匹配</dd></div>}
                <div><dt>入口 ID</dt><dd className="break-value">{event.entryId}</dd></div>
              </dl>
            ) : tab === 'composition' && event.systemPrompt?.composition ? (
              <PromptCompositionView
                composition={event.systemPrompt.composition}
                promptBeforeFinalExtensions={event.systemPrompt.promptBeforeFinalExtensions}
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
