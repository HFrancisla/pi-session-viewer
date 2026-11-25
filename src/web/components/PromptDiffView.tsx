import { useI18n } from '../i18n'
import { CopyButton } from './CopyButton'
import type { TimelineEvent } from '../../core/types'
import { diffPersistedState } from '../../core/native-diff'

export function PromptDiffView({ event }: { event: TimelineEvent }) {
  const { t, locale } = useI18n()
  const zh = locale === 'zh-CN'
  const state = event.persistedState
  const changes = state && diffPersistedState(state)
  return <div className="content-view diff-view">
    <div className="content-header-toolbar">
      <span role="group" aria-label={t.inspector.diff.baselineLabel}>
        {zh ? '前一已知状态' : 'Previous known state'}{state?.previous && <>: <code>{state.previous.entryId}</code></>}
      </span>
      <CopyButton label={t.inspector.diff.copyDiff} disabled={!changes} text={JSON.stringify(changes ?? [], null, 2)} />
    </div>
    {!changes ? <p>{zh ? '没有可比较的前一已知状态' : 'No preceding known state to compare'}</p>
      : !changes.length ? <p>{t.inspector.diff.noChanges}</p>
      : changes.map(change => <details className="prompt-block" key={change.kind + ':' + change.name}>
        <summary>{change.before === undefined ? '+' : change.after === undefined ? '−' : '±'} {change.kind}: {change.name}</summary>
        {change.before !== undefined && <div className="content-body-wrap"><span>−</span><pre>{typeof change.before === 'string' ? change.before : JSON.stringify(change.before, null, 2)}</pre></div>}
        {change.after !== undefined && <div className="content-body-wrap"><span>+</span><pre>{typeof change.after === 'string' ? change.after : JSON.stringify(change.after, null, 2)}</pre></div>}
      </details>)}
  </div>
}
