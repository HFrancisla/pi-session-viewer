import { AlertCircle, ArrowLeft, Bot, Clock3, Copy, Menu, PanelRightOpen, RefreshCw, Rows3, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fetchSession, fetchSessions } from './api'
import { Inspector } from './components/Inspector'
import { SessionSidebar } from './components/SessionSidebar'
import { Timeline, type TimelineHandle } from './components/Timeline'
import { formatDateTime, formatDuration } from '../core/format'
import { createSessionCatalog } from '../core/session-catalog'
import { buildSessionView, getSessionTitle, parseSessionJsonl, primaryEventForEntry } from '../core/session-parser'
import { findPreviousPromptSnapshot } from '../core/prompt-diff'
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
  const [currentCwd, setCurrentCwd] = useState<string | null>(() => browserInitialCwd())
  const [scopeMode, setScopeMode] = useState<'current' | 'all'>('current')
  const [selectedProjectCwd, setSelectedProjectCwd] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [sessionRoot, setSessionRoot] = useState('')
  const [listWarnings, setListWarnings] = useState<string[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<TimelineHandle>(null)
  const sessionChoiceStartedRef = useRef(false)

  const catalog = useMemo(() => createSessionCatalog(sessions, currentCwd), [sessions, currentCwd])

  const reloadSessions = useCallback(async () => {
    if (!accessToken) {
      setListLoading(false)
      return null
    }
    setListLoading(true)
    try {
      const payload = await fetchSessions(accessToken)
      setSessions(payload.sessions)
      setSessionRoot(payload.root)
      setListWarnings(payload.warnings)
      if (payload.currentCwd) {
        setCurrentCwd((prev) => prev ?? payload.currentCwd ?? null)
      }
      return payload
    } catch (error) {
      setListWarnings([error instanceof Error ? error.message : String(error)])
      return null
    } finally {
      setListLoading(false)
    }
  }, [accessToken])

  const [controller] = useState(() => createSessionViewController<File>({
    readServerSession: async (token) => {
      if (!accessToken) throw { code: 'missing-token' }
      return fetchSession(token, accessToken)
    },
    readImportedFile: (source) => source.file.text(),
    refreshCatalog: reloadSessions,
    cache: sessionCache,
    parseSession: (content, sourceName) => measurePerformance('pi-session-viewer:parse-session', () => parseSessionJsonl(content, sourceName)),
    buildView: (parsed, leafId, projection) => measurePerformance(
      'pi-session-viewer:build-session-view',
      () => buildSessionView(parsed, leafId, projection),
    ),
    now: () => new Date().toISOString(),
  }))
  const sessionState = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const activeSession = sessionState.active
  const sessionLoading = sessionState.loading
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
  const importedFileName = importedSource?.name ?? ''
  const view = sessionState.view
  const activeContextProjection = sessionState.contextProjection
  const selectedEvent = useMemo(
    () => view?.events.find((event) => event.id === selectedEventId) ?? null,
    [view, selectedEventId],
  )
  const previousPrompt = useMemo(() => {
    if (!view || selectedEvent?.kind !== 'system-prompt') return undefined
    return findPreviousPromptSnapshot(view.events, selectedEvent.id)
  }, [view, selectedEvent])
  const filteredTurns = useMemo(() => (
    view?.turns
      .map((turn) => ({ ...turn, events: turn.events.filter((event) => enabledKinds.has(event.kind)) }))
      .filter((turn) => turn.events.length > 0) ?? []
  ), [view, enabledKinds])
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

  useEffect(() => {
    let cancelled = false
    reloadSessions().then((payload) => {
      if (cancelled || !payload || !payload.sessions.length || sessionChoiceStartedRef.current) return
      if (controller.getSnapshot().active || controller.getSnapshot().loading) return
      const targetCwd = payload.currentCwd ?? currentCwd ?? browserInitialCwd()
      const initialSession = createSessionCatalog(payload.sessions, targetCwd).findInitialSession(targetCwd)
      if (initialSession) void controller.dispatch({ type: 'open', session: initialSession })
    })
    return () => { cancelled = true }
  }, [currentCwd, controller, reloadSessions])

  const refreshCurrent = useCallback(async () => {
    sessionChoiceStartedRef.current = true
    const viewport = timelineRef.current?.getViewport() ?? null
    if (controller.getSnapshot().active) {
      await controller.dispatch({ type: 'refresh', viewport })
      return
    }

    const payload = await reloadSessions()
    if (!payload || controller.getSnapshot().active || controller.getSnapshot().loading) return
    const targetCwd = payload.currentCwd ?? currentCwd ?? browserInitialCwd()
    const initialSession = createSessionCatalog(payload.sessions, targetCwd).findInitialSession(targetCwd)
    if (initialSession) void controller.dispatch({ type: 'open', session: initialSession })
  }, [controller, currentCwd, reloadSessions])

  const openServerSession = useCallback((session: SessionListItem) => {
    sessionChoiceStartedRef.current = true
    setSidebarOpen(false)
    void controller.dispatch({ type: 'open', session })
  }, [controller])

  const openSubagent = useCallback((reference: SubagentReference, sourceEventId?: string) => {
    sessionChoiceStartedRef.current = true
    const viewport = timelineRef.current?.getViewport() ?? null
    void controller.dispatch({ type: 'open-subagent', reference, sourceEventId, viewport })
  }, [controller])

  const returnToParent = useCallback(() => {
    sessionChoiceStartedRef.current = true
    const viewport = timelineRef.current?.getViewport() ?? null
    void controller.dispatch({ type: 'return-to-parent', viewport })
  }, [controller])

  const importFile = useCallback((file: File) => {
    sessionChoiceStartedRef.current = true
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
    const events = view?.events.filter((event) => event.entryId === entryId) ?? []
    const target = primaryEventForEntry(events)
    if (!target) return
    void controller.dispatch({ type: 'jump-to-event', eventId: target.id })
    setInspectorOpen(true)
  }, [controller, view])

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
  // Memoized: the title is derived from the parsed session, so recomputing it in
  // the render body made every render (including each selection change) pay for
  // scanning the session again.
  const title = useMemo(
    () => (parsedSession ? getSessionTitle(parsedSession) : t.header.selectSession),
    [parsedSession, t.header.selectSession],
  )
  const fullJsonlPath = useMemo(() => {
    const rel = selectedMetadata?.relativePath || parsedSession?.sourceName || importedFileName || ''
    if (!rel) return ''
    if (rel.startsWith('/') || !sessionRoot) return rel
    const cleanRoot = sessionRoot.replace(/\/+$/, '')
    const cleanRel = rel.replace(/^\/+/, '')
    return `${cleanRoot}/${cleanRel}`
  }, [selectedMetadata?.relativePath, parsedSession?.sourceName, importedFileName, sessionRoot])

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
            onClick={() => void refreshCurrent()}
            disabled={sessionLoading || listLoading || (!accessToken && !importedFile)}
            title={t.header.reloadTitle}
            aria-label={t.header.reloadTitle}
          >
            <RefreshCw className={sessionLoading || listLoading ? 'spin' : ''} size={18} />
          </button>
          <button className="icon-button mobile-only" type="button" onClick={() => { setSidebarOpen(false); setInspectorOpen(true) }} title={t.header.openInspector} aria-label={t.header.openInspector}>
            <PanelRightOpen size={19} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <div className={`sidebar-layer${sidebarOpen ? ' is-open' : ''}`}>
          <SessionSidebar
            catalog={catalog}
            selectedToken={selectedToken}
            root={sessionRoot}
            loading={listLoading}
            warnings={listWarnings}
            currentCwd={currentCwd}
            scopeMode={scopeMode}
            selectedProjectCwd={selectedProjectCwd}
            onScopeModeChange={setScopeMode}
            onProjectFilterChange={setSelectedProjectCwd}
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
                <div><span>{t.overview.entries}</span><strong>{parsedSession.stats.entryCount}</strong></div>
                <div><span>{t.overview.turns}</span><strong>{parsedSession.stats.turnCount}</strong></div>
                <div><span>{t.overview.duration}</span><strong>{formatDuration(parsedSession.stats.elapsedMs)}</strong></div>
                <div><span>{t.overview.started}</span><strong>{formatDateTime(parsedSession.stats.startedAt)}</strong></div>
              </section>
              <Timeline
                ref={timelineRef}
                session={parsedSession}
                turns={filteredTurns}
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
