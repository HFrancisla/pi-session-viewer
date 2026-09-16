import { FileJson2, FolderOpen, LoaderCircle, MessageSquareText } from 'lucide-react'
import type { SessionListItem } from '../../core/types'
import { formatDateTime } from '../../core/format'

interface SessionSidebarProps {
  sessions: SessionListItem[]
  selectedToken: string | null
  root: string
  loading: boolean
  warnings: string[]
  onSelect: (session: SessionListItem) => void
  onImport: () => void
}

function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? cwd
}

export function SessionSidebar({ sessions, selectedToken, root, loading, warnings, onSelect, onImport }: SessionSidebarProps) {
  return (
    <aside className="session-sidebar" aria-label="会话列表">
      <div className="sidebar-heading">
        <div>
          <h2>会话</h2>
          <p>{loading ? '正在扫描本地记录' : `${sessions.length} 个可用记录`}</p>
        </div>
        {loading && <LoaderCircle className="spin" size={18} aria-label="正在加载" />}
      </div>

      <button className="import-button" type="button" onClick={onImport}>
        <FolderOpen size={17} />
        打开 JSONL
      </button>

      {warnings.length > 0 && (
        <div className="sidebar-warning" role="status">{warnings[0]}</div>
      )}

      <nav className="session-list">
        {sessions.map((session) => (
          <button
            className={`session-item${selectedToken === session.token ? ' is-selected' : ''}`}
            key={session.token}
            type="button"
            onClick={() => onSelect(session)}
            aria-current={selectedToken === session.token ? 'page' : undefined}
          >
            <MessageSquareText size={17} aria-hidden="true" />
            <span className="session-item-copy">
              <strong>{session.title}</strong>
              <span>{formatDateTime(session.timestamp ?? session.modifiedAt)} · {projectName(session.cwd)}</span>
            </span>
          </button>
        ))}
      </nav>

      {!loading && sessions.length === 0 && (
        <div className="sidebar-empty">
          <FileJson2 size={22} />
          <p>会话目录中没有可读取的 Pi 记录。</p>
        </div>
      )}

      <div className="session-root" title={root}>
        <span>只读目录</span>
        <code>{root || '尚未连接'}</code>
      </div>
    </aside>
  )
}
