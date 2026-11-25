import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { computeLineDiff, diffPersistedStateLines, formatDiffLineTooltip } from '../../core/native-diff'
import type { TimelineEvent } from '../../core/types'
import { useI18n } from '../i18n'
import { CopyButton } from './CopyButton'
import { getSystemMessageText } from '@earendil-works/pi-ai/utils/text'
import { renderVanillaBaseline, type VanillaBaseline } from '../../core/vanilla-baseline'

declare const __PI_VANILLA_BASELINE__: VanillaBaseline
const baseline = __PI_VANILLA_BASELINE__

export function PromptDiffView({ event, cwd }: { event: TimelineEvent; cwd?: string }) {
  const { t } = useI18n()
  const state = event.persistedState
  const [selectedMode, setMode] = useState<'previous' | 'vanilla'>(state?.previous ? 'previous' : 'vanilla')
  const mode = state?.previous ? selectedMode : 'vanilla'
  const diffResult = useMemo(() => state && (mode === 'previous'
    ? diffPersistedStateLines(state)
    : computeLineDiff(renderVanillaBaseline(baseline, state.message, cwd), getSystemMessageText(state.message))
  ), [state, mode, cwd])
  const diffText = useMemo(() => (diffResult?.lines ?? []).map(line => {
    const prefix = line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '
    return `${prefix}${line.text}`
  }).join('\n'), [diffResult])
  const isUnavailable = !diffResult
  const addedCount = diffResult?.addedCount ?? 0
  const removedCount = diffResult?.removedCount ?? 0
  const isIdentical = !isUnavailable && addedCount === 0 && removedCount === 0

  return (
    <div className="content-view diff-view">
      <div className="content-header-toolbar">
        {!isUnavailable && <div className="prompt-diff-badges">
          <span
            className={`diff-count-badge is-added${addedCount === 0 ? ' is-dim' : ''}`}
            title={t.inspector.diff.addedLines(addedCount)}
          >+{addedCount}</span>
          <span
            className={`diff-count-badge is-removed${removedCount === 0 ? ' is-dim' : ''}`}
            title={t.inspector.diff.removedLines(removedCount)}
          >-{removedCount}</span>
        </div>}
        {state && <div className="prompt-diff-baseline-control" role="group" aria-label={t.inspector.diff.baselineLabel}>
          <span className="prompt-diff-baseline-label">{t.inspector.diff.baselineLabel}:</span>
          {state.previous && <button type="button" className={`prompt-diff-baseline-pill${mode === 'previous' ? ' is-active' : ''}`}
            aria-pressed={mode === 'previous'}
            title={state.previous.entryId}
            onClick={() => setMode('previous')}>
            {t.inspector.diff.baselinePrevious}
          </button>}
          <button type="button" className={`prompt-diff-baseline-pill${mode === 'vanilla' ? ' is-active' : ''}`}
            aria-pressed={mode === 'vanilla'} title={t.inspector.diff.vanillaHint(baseline.version)}
            onClick={() => setMode('vanilla')}>
            {t.inspector.diff.baselineVanilla(baseline.version)}
          </button>
        </div>}
        <CopyButton text={diffText} label={t.inspector.diff.copyDiff} disabled={isUnavailable} />
      </div>
      {isUnavailable ? (
        <div className="prompt-diff-empty">
          <Info size={20} />
          <p>{state ? t.inspector.state.noBaseline : t.inspector.state.unknown}</p>
        </div>
      ) : isIdentical ? (
        <div className="prompt-diff-empty">
          <Info size={20} />
          <p>{t.inspector.diff.noChanges}</p>
        </div>
      ) : (
        <div className="diff-table">
          {diffResult.lines.map((line, idx) => (
            <div key={idx} className={`diff-row diff-row--${line.type}`} title={formatDiffLineTooltip(line, {
              current: t.inspector.diff.currentSuffix,
              baseline: t.inspector.diff.baselineSuffix,
            })}>
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
