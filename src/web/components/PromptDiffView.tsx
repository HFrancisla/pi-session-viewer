import { Check, Copy, Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatDiffLineTooltip, resolvePromptDiff } from '../../core/prompt-diff'
import type { TimelineEvent } from '../../core/types'
import { useI18n } from '../i18n'

export function PromptDiffView({ event }: { event: TimelineEvent }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  const diffResult = useMemo(() => {
    return resolvePromptDiff(
      event.content,
      event.systemPrompt
    )
  }, [event.content, event.systemPrompt])

  const handleCopy = async () => {
    try {
      const diffText = diffResult.lines
        .map((l) => {
          const prefix = l.type === 'added' ? '+ ' : l.type === 'removed' ? '- ' : '  '
          return `${prefix}${l.text}`
        })
        .join('\n')
      await navigator.clipboard.writeText(diffText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard error
    }
  }

  const { addedCount, removedCount, lines } = diffResult
  const isIdentical = addedCount === 0 && removedCount === 0

  return (
    <div className="content-view diff-view">
      <div className="content-header-toolbar">
        <div className="diff-header-meta">
          <div className="prompt-diff-badges">
            <span
              className={`diff-count-badge is-added${addedCount === 0 ? ' is-dim' : ''}`}
              title={t.inspector.diff.addedLines(addedCount)}
            >
              +{addedCount}
            </span>
            <span
              className={`diff-count-badge is-removed${removedCount === 0 ? ' is-dim' : ''}`}
              title={t.inspector.diff.removedLines(removedCount)}
            >
              -{removedCount}
            </span>
          </div>

          <span className="diff-header-divider" aria-hidden="true" />

          <div className="prompt-diff-baseline-control">
            <span className="prompt-diff-baseline-label">{t.inspector.diff.baselineLabel}:</span>
            <span className="prompt-diff-baseline-pill">
              {t.inspector.diff.baselineVanilla}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="inspector-action-btn"
          onClick={handleCopy}
          title={t.inspector.diff.copyDiff}
        >
          {copied ? <Check size={13} className="copy-success-icon" /> : <Copy size={13} />}
          <span>{copied ? t.common.copied : t.inspector.diff.copyDiff}</span>
        </button>
      </div>

      {isIdentical ? (
        <div className="prompt-diff-empty">
          <Info size={20} />
          <p>{t.inspector.diff.noChanges}</p>
        </div>
      ) : (
        <div className="diff-table">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className={`diff-row diff-row--${line.type}`}
              title={formatDiffLineTooltip(line, {
                current: t.inspector.diff.currentSuffix,
                baseline: t.inspector.diff.baselineSuffix,
              })}
            >
              <span className="diff-sign" aria-hidden="true">
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
              </span>
              <span className="diff-content">{line.text || ' '}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
