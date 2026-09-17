import { FileJson2, FolderOpen, LoaderCircle, MessageSquareText } from 'lucide-react'
import { useMemo } from 'react'
import type { SessionListItem } from '../../core/types'
import { formatDateTime } from '../../core/format'

export interface ProjectSummary {
  cwd: string
  name: string
  count: number
  latestModifiedAt: string
}

interface SessionSidebarProps {
  sessions: SessionListItem[]
  selectedToken: string | null
  root: string
  loading: boolean
  warnings: string[]
  currentCwd: string | null
  scopeMode: 'current' | 'all'
  selectedProjectCwd: string | null
  onScopeModeChange: (mode: 'current' | 'all') => void
  onProjectFilterChange: (cwd: string | null) => void
  onSelect: (session: SessionListItem) => void
  onImport: () => void
}

export function normalizePath(cwd?: string | null): string {
  if (!cwd) return ''
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function projectName(cwd: string): string {
  if (!cwd || cwd === '未知工作目录') return '未知项目'
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? cwd
}

export function sessionItemTitle(session: SessionListItem, root?: string): string {
  const fileName = session.relativePath.split(/[\\/]/).filter(Boolean).at(-1) ?? session.relativePath
  const lines: string[] = []
  if (fileName) {
    lines.push(`文件：${fileName}`)
  }
  if (session.cwd) {
    lines.push(`工作目录：${session.cwd}`)
  }
  if (root && session.relativePath) {
    const sep = root.endsWith('/') || root.endsWith('\\') ? '' : '/'
    lines.push(`完整路径：${root}${sep}${session.relativePath}`)
  }
  return lines.join('\n')
}

/**
 * Disambiguates duplicate project directory basenames by prepending the minimum
 * number of parent directory segments required to make each label unique.
 * e.g. ['/a/work/server', '/b/work/server', '/c/client']
 *   -> Map { '/a/work/server' => 'a/work/server', '/b/work/server' => 'b/work/server', '/c/client' => 'client' }
 */
export function disambiguateProjectNames(cwds: string[]): Map<string, string> {
  const result = new Map<string, string>()
  const parsed = cwds.map((cwd) => {
    const norm = normalizePath(cwd)
    const segments = norm.split('/').filter(Boolean)
    return { cwd, norm, segments }
  })

  for (const item of parsed) {
    if (!item.norm || item.norm === '未知工作目录') {
      result.set(item.norm, '未知项目')
      continue
    }
    let depth = 1
    while (depth <= item.segments.length) {
      const candidate = item.segments.slice(-depth).join('/')
      const collision = parsed.some((other) => {
        if (other.norm === item.norm) return false
        const otherCandidate = other.segments.slice(-depth).join('/')
        return otherCandidate === candidate
      })
      if (!collision || depth === item.segments.length) {
        result.set(item.norm, candidate)
        break
      }
      depth++
    }
  }
  return result
}

export function groupProjects(sessions: SessionListItem[]): ProjectSummary[] {
  const map = new Map<string, { cwd: string; count: number; latestModifiedAt: string }>()
  for (const session of sessions) {
    const key = normalizePath(session.cwd) || '未知工作目录'
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        cwd: session.cwd,
        count: 1,
        latestModifiedAt: session.modifiedAt,
      })
    } else {
      existing.count += 1
      if (session.modifiedAt.localeCompare(existing.latestModifiedAt) > 0) {
        existing.latestModifiedAt = session.modifiedAt
      }
    }
  }

  const distinctCwds = Array.from(map.values()).map((item) => item.cwd)
  const disambiguatedNames = disambiguateProjectNames(distinctCwds)

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      name: disambiguatedNames.get(normalizePath(item.cwd)) ?? projectName(item.cwd),
    }))
    .sort((a, b) => b.latestModifiedAt.localeCompare(a.latestModifiedAt))
}

export function SessionSidebar({
  sessions,
  selectedToken,
  root,
  loading,
  warnings,
  currentCwd,
  scopeMode,
  selectedProjectCwd,
  onScopeModeChange,
  onProjectFilterChange,
  onSelect,
  onImport,
}: SessionSidebarProps) {
  const projects = useMemo(() => groupProjects(sessions), [sessions])

  const projectDisplayNames = useMemo(
    () => disambiguateProjectNames(projects.map((p) => p.cwd)),
    [projects],
  )

  const effectiveCurrentCwd = useMemo(() => {
    if (currentCwd) return currentCwd
    return projects[0]?.cwd ?? null
  }, [currentCwd, projects])

  const currentProject = useMemo(() => {
    if (!effectiveCurrentCwd) return null
    return projects.find((p) => normalizePath(p.cwd) === normalizePath(effectiveCurrentCwd)) ?? null
  }, [projects, effectiveCurrentCwd])

  const currentProjectCount = currentProject?.count ?? 0

  const filteredSessions = useMemo(() => {
    if (scopeMode === 'current') {
      if (!effectiveCurrentCwd) return sessions
      return sessions.filter((s) => normalizePath(s.cwd) === normalizePath(effectiveCurrentCwd))
    }
    if (selectedProjectCwd) {
      return sessions.filter((s) => normalizePath(s.cwd) === normalizePath(selectedProjectCwd))
    }
    return sessions
  }, [sessions, scopeMode, effectiveCurrentCwd, selectedProjectCwd])

  return (
    <aside className="session-sidebar" aria-label="会话列表">
      <div className="sidebar-heading">
        <div>
          <h2>会话</h2>
          <p>
            {loading
              ? '正在扫描本地记录'
              : scopeMode === 'current'
                ? `${filteredSessions.length} 个记录 · 共 ${sessions.length} 个`
                : `${filteredSessions.length} 个记录`}
          </p>
        </div>
        {loading && <LoaderCircle className="spin" size={18} aria-label="正在加载" />}
      </div>

      <div className="sidebar-scope" aria-label="会话范围切换">
        <div className="scope-tabs" role="tablist">
          <button
            className={`scope-tab${scopeMode === 'current' ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={scopeMode === 'current'}
            onClick={() => onScopeModeChange('current')}
            title={effectiveCurrentCwd ? `当前项目完整路径：${effectiveCurrentCwd}` : '当前项目'}
          >
            当前项目 ({currentProjectCount})
          </button>
          <button
            className={`scope-tab${scopeMode === 'all' ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={scopeMode === 'all'}
            onClick={() => onScopeModeChange('all')}
            title="查看所有工作区的全部会话"
          >
            全部 ({sessions.length})
          </button>
        </div>

        {scopeMode === 'all' && projects.length > 1 && (
          <div className="project-select-wrapper">
            <select
              className="project-select"
              value={selectedProjectCwd ?? ''}
              onChange={(e) => onProjectFilterChange(e.target.value || null)}
              aria-label="按项目过滤"
              title={selectedProjectCwd ? `当前过滤项目路径：${selectedProjectCwd}` : '全部项目（未按特定项目过滤）'}
            >
              <option value="" title="全部项目的历史会话">全部项目 ({sessions.length})</option>
              {projects.map((p) => (
                <option key={p.cwd} value={p.cwd} title={p.cwd}>
                  {p.name} ({p.count})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="sidebar-warning" role="status">{warnings[0]}</div>
      )}

      <nav className="session-list">
        {filteredSessions.map((session) => (
          <button
            className={`session-item${selectedToken === session.token ? ' is-selected' : ''}`}
            key={session.token}
            type="button"
            onClick={() => onSelect(session)}
            aria-current={selectedToken === session.token ? 'page' : undefined}
            title={sessionItemTitle(session, root)}
          >
            <MessageSquareText size={17} aria-hidden="true" />
            <span className="session-item-copy">
              <strong>{session.title}</strong>
              <span>
                {formatDateTime(session.timestamp ?? session.modifiedAt)}
                {scopeMode === 'all' ? ` · ${projectDisplayNames.get(normalizePath(session.cwd)) ?? projectName(session.cwd)}` : ''}
              </span>
            </span>
          </button>
        ))}
      </nav>

      {!loading && filteredSessions.length === 0 && sessions.length > 0 && scopeMode === 'current' && (
        <div className="sidebar-empty">
          <FileJson2 size={22} />
          <p>当前工作区暂无记录。</p>
          <button className="text-link-button" type="button" onClick={() => onScopeModeChange('all')}>
            查看全部项目历史 ({sessions.length})
          </button>
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="sidebar-empty">
          <FileJson2 size={22} />
          <p>会话目录中没有可读取的 Pi 记录。</p>
        </div>
      )}

      <div className="sidebar-footer">
        <button className="import-button" type="button" onClick={onImport}>
          <FolderOpen size={16} />
          打开 JSONL
        </button>

        <div className="session-root" title={root}>
          <span>只读目录</span>
          <code>{root || '尚未连接'}</code>
        </div>
      </div>
    </aside>
  )
}
