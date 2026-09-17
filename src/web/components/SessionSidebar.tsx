import { FileJson2, FolderOpen, LoaderCircle, MessageSquareText } from 'lucide-react'
import { useMemo } from 'react'
import type { SessionCatalog, ProjectSummary } from '../../core/session-catalog'
import { normalizePath } from '../../core/session-catalog'
import type { SessionListItem } from '../../core/types'
import { formatDateTime } from '../../core/format'
import { useI18n } from '../i18n'

export type { ProjectSummary }

interface SessionSidebarProps {
  catalog: SessionCatalog
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

export function SessionSidebar({
  catalog,
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
  const { t, localizeTitle } = useI18n()
  const projects = catalog.projects
  const sessions = catalog.allSessions

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
      return catalog.getSessionsForProject(effectiveCurrentCwd)
    }
    if (selectedProjectCwd) {
      return catalog.getSessionsForProject(selectedProjectCwd)
    }
    return sessions
  }, [catalog, sessions, scopeMode, effectiveCurrentCwd, selectedProjectCwd])

  return (
    <aside className="session-sidebar" aria-label={t.sidebar.heading}>
      <div className="sidebar-heading">
        <div>
          <h2>{t.sidebar.heading}</h2>
          <p>
            {loading
              ? t.sidebar.scanning
              : scopeMode === 'current'
                ? t.sidebar.recordsCountCurrent(filteredSessions.length, sessions.length)
                : t.sidebar.recordsCountAll(filteredSessions.length)}
          </p>
        </div>
        {loading && <LoaderCircle className="spin" size={18} aria-label={t.common.loading} />}
      </div>

      <div className="sidebar-scope" aria-label={t.sidebar.scopeSwitcher}>
        <div className="scope-tabs" role="tablist">
          <button
            className={`scope-tab${scopeMode === 'current' ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={scopeMode === 'current'}
            onClick={() => onScopeModeChange('current')}
            title={t.sidebar.scopeCurrentTooltip(effectiveCurrentCwd)}
          >
            {t.sidebar.scopeCurrent(currentProjectCount)}
          </button>
          <button
            className={`scope-tab${scopeMode === 'all' ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={scopeMode === 'all'}
            onClick={() => onScopeModeChange('all')}
            title={t.sidebar.scopeAllTooltip}
          >
            {t.sidebar.scopeAll(sessions.length)}
          </button>
        </div>

        {scopeMode === 'all' && projects.length > 1 && (
          <div className="project-select-wrapper">
            <select
              className="project-select"
              value={selectedProjectCwd ?? ''}
              onChange={(e) => onProjectFilterChange(e.target.value || null)}
              aria-label={t.sidebar.filterByProject}
              title={t.sidebar.selectedProjectTooltip(selectedProjectCwd)}
            >
              <option value="" title={t.sidebar.allProjectsOptionTooltip}>{t.sidebar.allProjectsOption(sessions.length)}</option>
              {projects.map((p) => (
                <option key={p.cwd} value={p.cwd} title={t.sidebar.projectOptionTooltip(p.cwd)}>
                  {localizeTitle(p.name)} ({p.count})
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
            title={catalog.formatSessionTooltip(session, root)}
          >
            <MessageSquareText size={17} aria-hidden="true" />
            <span className="session-item-copy">
              <strong>{session.title}</strong>
              <span>
                {formatDateTime(session.timestamp ?? session.modifiedAt)}
                {scopeMode === 'all' ? ` · ${localizeTitle(catalog.getProjectName(session.cwd))}` : ''}
              </span>
            </span>
          </button>
        ))}
      </nav>

      {!loading && filteredSessions.length === 0 && sessions.length > 0 && scopeMode === 'current' && (
        <div className="sidebar-empty">
          <FileJson2 size={22} />
          <p>{t.sidebar.emptyCurrent}</p>
          <button className="text-link-button" type="button" onClick={() => onScopeModeChange('all')}>
            {t.sidebar.viewAllProjectsButton(sessions.length)}
          </button>
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="sidebar-empty">
          <FileJson2 size={22} />
          <p>{t.sidebar.emptyAll}</p>
        </div>
      )}

      <div className="sidebar-footer">
        <button className="import-button" type="button" onClick={onImport}>
          <FolderOpen size={16} />
          {t.sidebar.openJsonl}
        </button>

        <div className="session-root" title={root}>
          <span>{t.sidebar.readOnlyDir}</span>
          <code>{root || t.sidebar.notConnected}</code>
        </div>
      </div>
    </aside>
  )
}
