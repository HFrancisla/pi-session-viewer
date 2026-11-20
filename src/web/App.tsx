import { AlertCircle, ArrowLeft, Bot, Clock3, Copy, FolderOpen, Menu, PanelRightOpen, RefreshCw, Rows3, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
import { useCopyFeedback } from './use-copy-feedback'
import type {
  EventKind,
  SessionListItem,
  SubagentReference,
  TimelineEvent,
} from '../core/types'
import { useI18n } from './i18n'

const initialCatalogLoadControllers = new WeakSet<object>()
const compactQuery = '(max-width: 1024px)'

function subscribeToCompactScreen(onChange: () => void) {
  const media = window.matchMedia(compactQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function isCompactScreen() {
  return window.matchMedia(compactQuery).matches
}

function CopySessionPathButton({ path }: { path: string }) {
  const { t } = useI18n()
  const { copy, status } = useCopyFeedback()

  return (
    <>
      <button
        type="button"
        className="icon-button header-path-copy"
        onClick={() => { if (path) void copy(path) }}
        disabled={!path}
        title={path || t.header.copySessionPath}
        aria-label={t.header.copySessionPath}
      >
        <Copy size={14} />
      </button>
      {status !== 'idle' && (
        <span role="status" className={`copy-status-toast${status === 'error' ? ' is-error' : ''}`}>
          {status === 'success' ? t.common.copiedTooltip : t.common.copyFailed}
        </span>
      )}
    </>
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
  const compactScreen = useSyncExternalStore(subscribeToCompactScreen, isCompactScreen, () => false)
  const [accessToken] = useState<string | null>(() => browserAccessToken())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<TimelineHandle>(null)
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!compactScreen) {
      setSidebarOpen(false)
      setInspectorOpen(false)
    }
  }, [compactScreen])

  const activeDrawer = compactScreen ? sidebarOpen ? 'sidebar' : inspectorOpen ? 'inspector' : null : null
  useEffect(() => {
    if (!activeDrawer) return
    const panel = document.querySelector<HTMLElement>(activeDrawer === 'sidebar' ? '.sidebar-layer' : '.inspector')
    if (!panel) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = document.querySelector<HTMLElement>(
      activeDrawer === 'sidebar' ? '.app-header > .mobile-only' : '.header-actions .mobile-only',
    )
    panel.querySelector<HTMLElement>(activeDrawer === 'sidebar' ? '.sidebar-close' : '.inspector-close')?.focus()

    const onDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSidebarOpen(false)
        setInspectorOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'))
      if (!focusable.length) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onDrawerKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onDrawerKeyDown, true)
      const opener = drawerReturnFocusRef.current
      const target = opener?.isConnected && !opener.closest('[inert]')
        ? opener
        : previousFocus?.isConnected && !previousFocus.closest('[inert]') ? previousFocus : fallback
      target?.focus()
      drawerReturnFocusRef.current = null
    }
  }, [activeDrawer])

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
    initialCatalogLoading: Boolean(accessToken),
  }))
  const sessionState = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    if (!accessToken || initialCatalogLoadControllers.has(controller)) return
    initialCatalogLoadControllers.add(controller)
    void controller.dispatch({ type: 'load-catalog', autoOpen: true })
  }, [accessToken, controller])

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
    setInspectorOpen(false)
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

  const selectEvent = useCallback((event: TimelineEvent, showDetails = true) => {
    void controller.dispatch({ type: 'select-event', eventId: event.id })
    if (compactScreen && showDetails) {
      if (!inspectorOpen) drawerReturnFocusRef.current = document.querySelector<HTMLElement>('.timeline-scroll')
      setInspectorOpen(true)
    }
  }, [compactScreen, controller, inspectorOpen])

  const jumpToSelectedEvent = useCallback(() => {
    if (selectedEvent) {
      void controller.dispatch({ type: 'jump-to-event', eventId: selectedEvent.id })
      if (compactScreen) setInspectorOpen(false)
    }
  }, [compactScreen, controller, selectedEvent])

  const jumpToEntry = useCallback((entryId: string) => {
    void controller.dispatch({ type: 'jump-to-entry', entryId })
    if (compactScreen) setInspectorOpen(false)
  }, [compactScreen, controller])

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
  const blockingError = parsedSession && view ? null : displayError
  const title = sessionState.sessionTitle ?? t.header.selectSession

  return (
    <div className="app-shell">
      <header className="app-header" inert={Boolean(activeDrawer)}>
        <button className="icon-button mobile-only" type="button" onClick={(event) => { drawerReturnFocusRef.current = event.currentTarget; setInspectorOpen(false); setSidebarOpen(true) }} title={t.header.openSidebar} aria-label={t.header.openSidebar}>
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
            title={locale === 'en' ? t.header.switchToChinese : t.header.switchToEnglish}
            aria-label={locale === 'en' ? t.header.switchToChinese : t.header.switchToEnglish}
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
          <button className="icon-button mobile-only" type="button" onClick={(event) => { drawerReturnFocusRef.current = event.currentTarget; setSidebarOpen(false); setInspectorOpen(true) }} title={t.header.openInspector} aria-label={t.header.openInspector}>
            <PanelRightOpen size={19} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <div
          className={`sidebar-layer${sidebarOpen ? ' is-open' : ''}`}
          inert={compactScreen && !sidebarOpen}
          role={activeDrawer === 'sidebar' ? 'dialog' : undefined}
          aria-modal={activeDrawer === 'sidebar' ? true : undefined}
          aria-label={activeDrawer === 'sidebar' ? t.sidebar.heading : undefined}
          tabIndex={-1}
        >
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
            onClose={() => setSidebarOpen(false)}
          />
        </div>

        <main className="main-stage" inert={Boolean(activeDrawer)}>
          {parsedSession && view && (
            <div className="mobile-session-heading">
              <strong>{title}</strong>
              <CopySessionPathButton path={fullJsonlPath} />
            </div>
          )}
          {blockingError ? (
            <div className="load-state is-error" role="alert">
              <AlertCircle size={28} />
              <h1>{!loadError && !accessToken && !importedFile ? t.overview.missingAccessTitle : t.overview.failedToOpen}</h1>
              <p>{blockingError}</p>
              {!accessToken && !importedFile && (
                <div className="load-state-actions">
                  <span>{t.overview.offlineImportHint}</span>
                  <button type="button" className="empty-import-button" onClick={() => fileInput.current?.click()}>
                    <FolderOpen size={16} aria-hidden="true" />
                    {t.sidebar.openJsonl}
                  </button>
                </div>
              )}
            </div>
          ) : parsedSession && view ? (
            <>
              {loadError && (
                <div className="action-error-strip" role="alert">
                  <AlertCircle size={14} />
                  <span>{t.overview.failedToOpen}: {loadError}</span>
                  <button type="button" onClick={() => void controller.dispatch({ type: 'dismiss-load-error' })} aria-label={t.common.dismiss}>
                    <X size={13} />
                  </button>
                </div>
              )}
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
          compactScreen={compactScreen}
          onClose={() => setInspectorOpen(false)}
          onJumpToEvent={jumpToSelectedEvent}
          onJumpToEntry={jumpToEntry}
        />
      </div>

      {activeDrawer && <button className="mobile-backdrop" tabIndex={-1} type="button" onClick={() => { setSidebarOpen(false); setInspectorOpen(false) }} aria-label={t.header.closeOverlay} />}

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
