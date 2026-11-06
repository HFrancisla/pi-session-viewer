import { Check, Copy, Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatDiffLineTooltip, isVanillaBaselineCompatible, resolvePromptDiff, type DiffBaselineMode } from '../../core/prompt-diff'
import { PI_PROMPT_BASELINE_VERSION } from '../../core/pi-defaults'
import type { TimelineEvent } from '../../core/types'
import { useI18n } from '../i18n'

export function PromptDiffView({ event, previousPrompt }: { event: TimelineEvent; previousPrompt?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const hasPreviousPrompt = previousPrompt !== undefined
  const piVersion = event.systemPrompt?.piVersion
  const vanillaCompatible = isVanillaBaselineCompatible(piVersion)
  const [baselineMode, setBaselineMode] = useState<DiffBaselineMode>(
    hasPreviousPrompt ? 'previous' : vanillaCompatible ? 'vanilla' : 'unavailable'
  )
  const vanillaUnavailableMessage = t.inspector.diff.vanillaUnavailable(PI_PROMPT_BASELINE_VERSION, piVersion)

  const diffResult = useMemo(() => resolvePromptDiff(
    event.content,
    {
      composition: event.systemPrompt?.composition,
      piVersion,
      promptBeforeFinalExtensions: event.systemPrompt?.promptBeforeFinalExtensions,
      previousPrompt,
    },
    baselineMode,
  ), [event.content, event.systemPrompt?.composition, piVersion, event.systemPrompt?.promptBeforeFinalExtensions, previousPrompt, baselineMode])

  const handleCopy = async () => {
    try {
      const diffText = diffResult.lines
        .map((l) => {
          const prefix = l.type === 'added' ? '+ ' : l.type === 'removed' ? '- ' : '  '
          return `${prefix}${l.text}`
        })
        .join('\n')
      if (diffResult.baselineMode === 'unavailable') return
      await navigator.clipboard.writeText(diffText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard error
    }
  }

  const { addedCount, removedCount, lines } = diffResult
  const isUnavailable = diffResult.baselineMode === 'unavailable'
  const isIdentical = !isUnavailable && addedCount === 0 && removedCount === 0

  return (
    <div className="content-view diff-view">
      <div className="content-header-toolbar">
        <div className="diff-header-meta">
          {!isUnavailable && <div className="prompt-diff-badges">
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
          </div>}

          <span className="diff-header-divider" aria-hidden="true" />

          <div className="prompt-diff-baseline-control" role="group" aria-label={t.inspector.diff.baselineLabel}>
            <span className="prompt-diff-baseline-label">{t.inspector.diff.baselineLabel}:</span>
            <button
              type="button"
              className={`prompt-diff-baseline-pill${baselineMode === 'previous' ? ' is-active' : ''}`}
              aria-pressed={baselineMode === 'previous'}
              disabled={!hasPreviousPrompt}
              title={!hasPreviousPrompt ? t.inspector.diff.noPreviousPrompt : undefined}
              onClick={() => setBaselineMode('previous')}
            >
              {t.inspector.diff.baselinePrevious}
            </button>
            <button
              type="button"
              className={`prompt-diff-baseline-pill${baselineMode === 'vanilla' ? ' is-active' : ''}`}
              aria-pressed={baselineMode === 'vanilla'}
              disabled={!vanillaCompatible}
              title={!vanillaCompatible ? vanillaUnavailableMessage : undefined}
              onClick={() => setBaselineMode('vanilla')}
            >
              {t.inspector.diff.baselineVanilla(PI_PROMPT_BASELINE_VERSION)}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="inspector-action-btn"
          onClick={handleCopy}
          title={isUnavailable ? vanillaUnavailableMessage : t.inspector.diff.copyDiff}
          disabled={isUnavailable}
        >
          {copied ? <Check size={13} className="copy-success-icon" /> : <Copy size={13} />}
          <span>{copied ? t.common.copied : t.inspector.diff.copyDiff}</span>
        </button>
      </div>

      {isUnavailable ? (
        <div className="prompt-diff-empty">
          <Info size={20} />
          <p>{vanillaUnavailableMessage}</p>
        </div>
      ) : isIdentical ? (
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
