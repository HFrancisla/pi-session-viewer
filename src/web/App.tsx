import { AlertCircle, ArrowLeft, Bot, Clock3, Copy, Menu, PanelRightOpen, RefreshCw, Rows3, X } from 'lucide-react'
import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { fetchSession, fetchSessions, resolveSession } from './api'
import { Inspector } from './components/Inspector'
import { SessionSidebar } from './components/SessionSidebar'
import { Timeline, type TimelineHandle } from './components/Timeline'
import { formatDateTime, formatDuration } from '../core/format'
import { parseSessionJsonl } from '../core/session-parser'
import { buildSessionView } from '../core/session-view'
import { browserAccessToken, browserInitialCwd } from './session-auth'
import { sessionCache } from './session-cache'
import { createSessionViewController } from './session-view-controller'
import type {
  EventKind,
  SessionListItem,
  SubagentReference,
  TimelineEvent,
} from '../core/types'
import { useI18n } from './i18n'

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall back for browsers that expose the API but deny access in this context.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard access is unavailable')
}

function CopySessionPathButton({ path }: { path: string }) {
  const { t } = useI18n()

  const copyPath = async () => {
    if (!path) return
    try {
      await copyTextToClipboard(path)
    } catch {
      // The browser may deny clipboard access; keep the control available without claiming success.
    }
  }

  return (
    <button
      type="button"
      className="icon-button header-path-copy"
      onClick={() => void copyPath()}
      disabled={!path}
      title={path || t.header.copySessionPath}
      aria-label={t.header.copySessionPath}
    >
      <Copy size={14} />
    </button>
  )
}

function PiGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 28 28"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 11.2c.6-1.5 1.5-1.7 2.6-1.7h13.4" />
      <path d="M10.25 9.5v9.5" />
      <path d="M16.75 9.5v7c0 1.5 1 2.5 2.5 2.5" />
    </svg>
  )
}

function measurePerformance<T>(name: string, work: () => T): T {
  const start = performance.now()
  const result = work()
  performance.measure(name, { start, end: performance.now() })
  return result
}

function App() {
  const { t, locale, setLocale } = useI18n()
  const [accessToken] = useState<string | null>(() => browserAccessToken())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<TimelineHandle>(null)

  const [controller] = useState(() => createSessionViewController<File>({
    readServerSession: async (token) => {
      if (!accessToken) throw { code: 'missing-token' }
      return fetchSession(token, accessToken)
    },
    resolveSubagent: async (targetFile, parentRelative) => {
      if (!accessToken) throw { code: 'missing-token' }
      return resolveSession(targetFile, parentRelative, accessToken)
    },
    readImportedFile: (source) => source.file.text(),
    refreshCatalog: async () => {
      if (!accessToken) return null
      return fetchSessions(accessToken)
    },
    cache: sessionCache,
    parseSession: (content, sourceName) => measurePerformance('pi-session-viewer:parse-session', () => parseSessionJsonl(content, sourceName)),
    buildView: (parsed, leafId, projection) => measurePerformance(
      'pi-session-viewer:build-session-view',
      () => buildSessionView(parsed, leafId, projection),
    ),
    now: () => new Date().toISOString(),
    initialCwd: browserInitialCwd(),
    autoLoadCatalog: Boolean(accessToken),
  }))
  const sessionState = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const activeSession = sessionState.active
  const sessionLoading = sessionState.loading
  const catalog = sessionState.catalog
  const selectedToken = activeSession?.token ?? null
  const selectedMetadata = activeSession?.metadata ?? null
  const parsedSession = activeSession?.parsed ?? null
  const selectedLeafId = sessionState.selectedLeafId
  const selectedEventId = sessionState.selectedEventId
  const enabledKinds = sessionState.enabledKinds
  const sessionStack = sessionState.navigation
  const restorePosition = sessionState.restoreIntent
  const loadedAt = sessionState.loadedAt
  const importedSource = activeSession?.source.kind === 'file' ? activeSession.source.imported : null
  const importedFile = importedSource?.file ?? null
  const view = sessionState.view
  const activeContextProjection = sessionState.contextProjection
  const selectedEvent = sessionState.selectedEvent
  const previousPrompt = sessionState.previousPrompt
  const visibleTurns = sessionState.visibleTurns
  const fullJsonlPath = sessionState.fullJsonlPath

  const selectBranch = useCallback((leafId: string) => {
    void controller.dispatch({ type: 'select-branch', leafId })
  }, [controller])
  const toggleEventKind = useCallback((kind: EventKind) => {
    void controller.dispatch({ type: 'toggle-event-kind', kind })
  }, [controller])
  const toggleAllEventKinds = useCallback(() => {
    void controller.dispatch({ type: 'toggle-all-event-kinds' })
  }, [controller])
  const ensureEventKindEnabled = useCallback((kind: EventKind) => {
    void controller.dispatch({ type: 'ensure-event-kind', kind })
  }, [controller])
  const acknowledgeRestorePosition = useCallback((key: number) => {
    void controller.dispatch({ type: 'acknowledge-timeline-restore', key })
  }, [controller])

  const refreshCurrent = useCallback(() => {
    const viewport = timelineRef.current?.getViewport() ?? null
    void controller.dispatch({ type: 'refresh', viewport })
  }, [controller])

  const openServerSession = useCallback((session: SessionListItem) => {
    setSidebarOpen(false)
    void controller.dispatch({ type: 'open', session })
  }, [controller])

  const openSubagent = useCallback((reference: SubagentReference, sourceEventId?: string) => {
    const viewport = timelineRef.current?.getViewport() ?? null
    void controller.dispatch({ type: 'open-subagent', reference, sourceEventId, viewport })
  }, [controller])

  const returnToParent = useCallback(() => {
    const viewport = timelineRef.current?.getViewport() ?? null
    void controller.dispatch({ type: 'return-to-parent', viewport })
  }, [controller])

  const importFile = useCallback((file: File) => {
    setSidebarOpen(false)
    void controller.dispatch({ type: 'import', source: { name: file.name, file } })
  }, [controller])

  const selectEvent = useCallback((event: TimelineEvent) => {
    void controller.dispatch({ type: 'select-event', eventId: event.id })
    setInspectorOpen(true)
  }, [controller])

  const jumpToSelectedEvent = useCallback(() => {
    if (selectedEvent) void controller.dispatch({ type: 'jump-to-event', eventId: selectedEvent.id })
  }, [controller, selectedEvent])

  const jumpToEntry = useCallback((entryId: string) => {
    void controller.dispatch({ type: 'jump-to-entry', entryId })
    setInspectorOpen(true)
  }, [controller])

  const errorMessage = (error: NonNullable<typeof sessionState.loadError>) => {
    switch (error.code) {
      case 'missing-token': return t.header.missingToken
      case 'invalid-session': return t.header.invalidSessionFile
      case 'subagent-transcript-only': return t.header.subagentTranscriptOnly
      case 'operation-failed': return t.header.operationFailed
    }
  }
  const loadError = sessionState.loadError ? errorMessage(sessionState.loadError) : null
  const actionError = sessionState.actionError
    ? t.header.failedToLoadSubagent(errorMessage(sessionState.actionError))
    : null
  const displayError = loadError ?? (!accessToken && !importedFile ? t.header.missingToken : null)
  const title = sessionState.sessionTitle ?? t.header.selectSession

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="icon-button mobile-only" type="button" onClick={() => { setInspectorOpen(false); setSidebarOpen(true) }} title={t.header.openSidebar} aria-label={t.header.openSidebar}>
          <Menu size={19} />
        </button>
        <div className="product-mark" aria-label={t.common.productName}>
          <span className="product-glyph"><PiGlyph size={18} /></span>
          <strong>{t.common.productName}</strong>
        </div>
        {sessionStack.length > 0 ? (
          <div className="header-session header-session--breadcrumbs">
            <CopySessionPathButton path={fullJsonlPath} />
            <div className="breadcrumb-trail">
              <button
                type="button"
                className="breadcrumb-back-btn"
                onClick={returnToParent}
                title={t.header.backToParent}
                aria-label={t.header.backToParent}
              >
                <ArrowLeft size={15} />
                <span>{t.header.backToParent}</span>
              </button>
              <div className="breadcrumb-current">
                <span className="breadcrumb-badge"><Bot size={13} /> {t.header.subagentBadge}</span>
                <strong>{title}</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="header-session">
            <CopySessionPathButton path={fullJsonlPath} />
            <div className="header-session-info">
              <strong>{title}</strong>
              <span>{selectedMetadata?.cwd ?? parsedSession?.header?.cwd ?? t.header.noSessionLoaded}</span>
            </div>
          </div>
        )}
        <div className="header-actions">
          {loadedAt && <span className="loaded-at"><Clock3 size={14} />{t.header.loadedAt(formatDateTime(loadedAt))}</span>}
          <button
            type="button"
            className="lang-toggle-button"
            onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}
            title={locale === 'en' ? '切换为简体中文' : 'Switch to English'}
            aria-label="EN / 中"
          >
            <span className={locale === 'en' ? 'active' : ''}>EN</span>
            <span className="lang-separator">/</span>
            <span className={locale === 'zh-CN' ? 'active' : ''}>中</span>
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={refreshCurrent}
            disabled={sessionLoading || catalog.loading || (!accessToken && !importedFile)}
            title={t.header.reloadTitle}
            aria-label={t.header.reloadTitle}
          >
            <RefreshCw className={sessionLoading || catalog.loading ? 'spin' : ''} size={18} />
          </button>
          <button className="icon-button mobile-only" type="button" onClick={() => { setSidebarOpen(false); setInspectorOpen(true) }} title={t.header.openInspector} aria-label={t.header.openInspector}>
            <PanelRightOpen size={19} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <div className={`sidebar-layer${sidebarOpen ? ' is-open' : ''}`}>
          <SessionSidebar
            projects={catalog.projects}
            sessions={catalog.sessions}
            selectedToken={selectedToken}
            root={catalog.root}
            loading={catalog.loading}
            warnings={catalog.warnings}
            currentCwd={catalog.currentCwd}
            scopeMode={catalog.scopeMode}
            selectedProjectCwd={catalog.selectedProjectCwd}
            onScopeModeChange={(mode) => void controller.dispatch({ type: 'set-scope-mode', mode })}
            onProjectFilterChange={(cwd) => void controller.dispatch({ type: 'set-project-filter', cwd })}
            onSelect={openServerSession}
            onImport={() => fileInput.current?.click()}
          />
        </div>

        <main className="main-stage">
          {displayError ? (
            <div className="load-state is-error" role="alert">
              <AlertCircle size={28} />
              <h1>{t.overview.failedToOpen}</h1>
              <p>{displayError}</p>
            </div>
          ) : parsedSession && view ? (
            <>
              {actionError && (
                <div className="action-error-strip" role="alert">
                  <AlertCircle size={14} />
                  <span>{actionError}</span>
                  <button type="button" onClick={() => { void controller.dispatch({ type: 'dismiss-action-error' }) }} aria-label={t.common.dismiss}>
                    <X size={13} />
                  </button>
                </div>
              )}
              <section className="session-summary" aria-label={t.overview.sessionSummary}>
                <div><span>{t.overview.entries}</span><strong>{view.stats.entryCount}</strong></div>
                <div><span>{t.overview.turns}</span><strong>{view.stats.turnCount}</strong></div>
                <div><span>{t.overview.duration}</span><strong>{formatDuration(view.stats.elapsedMs)}</strong></div>
                <div><span>{t.overview.started}</span><strong>{formatDateTime(view.stats.startedAt)}</strong></div>
              </section>
              <Timeline
                ref={timelineRef}
                session={parsedSession}
                turns={visibleTurns}
                allEvents={view.events}
                selectedEventId={selectedEventId}
                restorePosition={restorePosition}
                selectedLeafId={selectedLeafId}
                contextProjection={activeContextProjection}
                enabledKinds={enabledKinds}
                onSelectEvent={selectEvent}
                onSelectBranch={selectBranch}
                onToggleKind={toggleEventKind}
                onToggleAllKinds={toggleAllEventKinds}
                onEnsureEventKindEnabled={ensureEventKindEnabled}
                onRestorePositionApplied={acknowledgeRestorePosition}
                onOpenSubagent={openSubagent}
              />
            </>
          ) : (
            <div className="load-state">
              <Rows3 size={30} />
              <h1>{sessionLoading ? t.overview.loadingTitle : t.overview.emptyTitle}</h1>
              <p>{sessionLoading ? t.overview.loadingDesc : t.overview.emptyDesc}</p>
            </div>
          )}
        </main>

        <Inspector
          event={selectedEvent}
          previousPrompt={previousPrompt}
          mobileOpen={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          onJumpToEvent={jumpToSelectedEvent}
          onJumpToEntry={jumpToEntry}
        />
      </div>

      {(sidebarOpen || inspectorOpen) && <button className="mobile-backdrop" type="button" onClick={() => { setSidebarOpen(false); setInspectorOpen(false) }} aria-label={t.header.closeOverlay} />}

      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".jsonl,application/json,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}

export default App
