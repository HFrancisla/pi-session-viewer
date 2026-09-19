import { AlertCircle, ArrowLeft, Bot, Clock3, Menu, PanelRightOpen, RefreshCw, Rows3 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSession, fetchSessions } from './api'
import { Inspector } from './components/Inspector'
import { SessionSidebar } from './components/SessionSidebar'
import { Timeline } from './components/Timeline'
import { allEventKinds } from '../core/event-kinds'
import { formatDateTime, formatDuration } from '../core/format'
import { createSessionCatalog } from '../core/session-catalog'
import { buildSessionView, getSessionTitle, parseSessionJsonl } from '../core/session-parser'
import { encodeSessionToken } from '../core/session-token'
import { browserAccessToken, browserInitialCwd } from './session-auth'
import type { EventKind, ParsedSession, SessionListItem, SubagentReference, TimelineEvent } from '../core/types'
import { useI18n } from './i18n'

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

export interface RestorePosition {
  eventId: string | null
  scrollTop?: number
  key: number
}

interface SessionStackFrame {
  token: string | null
  metadata: SessionListItem | null
  parsedSession: ParsedSession
  selectedLeafId: string | null
  selectedEventId: string | null
  importedFile: File | null
  rawContent: string
  title: string
  scrollTop?: number
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
  const [sessionLoading, setSessionLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [selectedMetadata, setSelectedMetadata] = useState<SessionListItem | null>(null)
  const [parsedSession, setParsedSession] = useState<ParsedSession | null>(null)
  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [enabledKinds, setEnabledKinds] = useState<Set<EventKind>>(() => new Set(allEventKinds))
  const [importedFile, setImportedFile] = useState<File | null>(null)
  const [sessionStack, setSessionStack] = useState<SessionStackFrame[]>([])
  const [restorePosition, setRestorePosition] = useState<RestorePosition | null>(null)
  const restoreKeyRef = useRef(0)
  const sessionViewportsRef = useRef<Map<string, { scrollTop: number; selectedEventId: string | null }>>(new Map())
  const currentSelectedTokenRef = useRef<string | null>(null)
  currentSelectedTokenRef.current = selectedToken
  const currentSelectedEventIdRef = useRef<string | null>(null)
  currentSelectedEventIdRef.current = selectedEventId
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const currentContentRef = useRef<string>('')

  const catalog = useMemo(() => createSessionCatalog(sessions, currentCwd), [sessions, currentCwd])

  const applyContent = useCallback((
    content: string,
    sourceName: string,
    metadata: SessionListItem | null,
    initialEventId?: string | null,
  ) => {
    currentContentRef.current = content
    const parsed = parseSessionJsonl(content, sourceName)
    setParsedSession(parsed)
    setSelectedMetadata(metadata)
    setSelectedLeafId(parsed.currentLeafId)
    setSelectedEventId(initialEventId ?? null)
    setRestorePosition(null)
    setLoadedAt(new Date().toISOString())
    setLoadError(null)
  }, [])

  const openServerSession = useCallback(async (session: SessionListItem) => {
    if (!accessToken) return
    sessionViewportsRef.current.clear()
    setSessionLoading(true)
    setSelectedToken(session.token)
    setImportedFile(null)
    setSidebarOpen(false)
    setSessionStack([])
    try {
      const payload = await fetchSession(session.token, accessToken)
      applyContent(payload.content, payload.relativePath, session)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionLoading(false)
    }
  }, [accessToken, applyContent])

  const openSubagent = useCallback(async (subagent: SubagentReference, sourceEventId?: string) => {
    if (!parsedSession) return

    const scrollContainer = document.querySelector('.timeline-scroll')
    const currentScrollTop = scrollContainer ? scrollContainer.scrollTop : undefined

    if (currentSelectedTokenRef.current && currentScrollTop != null) {
      sessionViewportsRef.current.set(currentSelectedTokenRef.current, {
        scrollTop: currentScrollTop,
        selectedEventId: currentSelectedEventIdRef.current,
      })
    }

    const jumpEventId = sourceEventId ?? selectedEventId
    const currentFrame: SessionStackFrame = {
      token: selectedToken,
      metadata: selectedMetadata,
      parsedSession,
      selectedLeafId,
      selectedEventId: jumpEventId,
      importedFile,
      rawContent: currentContentRef.current,
      title: parsedSession ? getSessionTitle(parsedSession) : t.header.selectSession,
      scrollTop: currentScrollTop,
    }

    setSessionLoading(true)
    setLoadError(null)

    try {
      let content: string | undefined
      let resolvedRelativePath = subagent.targetFile

      if (accessToken) {
        try {
          const payload = await fetchSession(subagent.token, accessToken)
          content = payload.content
          resolvedRelativePath = payload.relativePath
        } catch (primaryErr) {
          const parentRelative = selectedMetadata?.relativePath ?? parsedSession.sourceName
          const parentDir = parentRelative.includes('/') ? parentRelative.slice(0, parentRelative.lastIndexOf('/')) : null
          if (parentDir && !subagent.targetFile.startsWith(parentDir)) {
            const nestedTarget = `${parentDir}/${subagent.targetFile}`
            const nestedToken = encodeSessionToken(nestedTarget)
            const fallbackPayload = await fetchSession(nestedToken, accessToken)
            content = fallbackPayload.content
            resolvedRelativePath = fallbackPayload.relativePath
          } else {
            throw primaryErr
          }
        }
      } else {
        throw new Error(t.header.missingToken)
      }

      if (content) {
        setSessionStack((prev) => [...prev, currentFrame])
        const syntheticToken = encodeSessionToken(resolvedRelativePath)
        setSelectedToken(syntheticToken)
        setImportedFile(null)
        const syntheticMetadata: SessionListItem = {
          token: syntheticToken,
          id: subagent.targetFile,
          title: subagent.agentName ? `${subagent.agentName} (Subagent)` : `Subagent (${resolvedRelativePath})`,
          cwd: selectedMetadata?.cwd ?? parsedSession.header?.cwd ?? '',
          modifiedAt: new Date().toISOString(),
          relativePath: resolvedRelativePath,
          parentSession: parsedSession.header?.id,
        }

        const cachedViewport = sessionViewportsRef.current.get(syntheticToken)
        if (cachedViewport) {
          applyContent(content, resolvedRelativePath, syntheticMetadata, cachedViewport.selectedEventId)
          setRestorePosition({
            eventId: cachedViewport.selectedEventId,
            scrollTop: cachedViewport.scrollTop,
            key: ++restoreKeyRef.current,
          })
        } else {
          applyContent(content, resolvedRelativePath, syntheticMetadata, null)
          setRestorePosition({
            eventId: null,
            scrollTop: 0,
            key: ++restoreKeyRef.current,
          })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(t.header.failedToLoadSubagent(message))
    } finally {
      setSessionLoading(false)
    }
  }, [accessToken, applyContent, importedFile, parsedSession, selectedEventId, selectedLeafId, selectedMetadata, selectedToken, t.header])

  const popSessionStack = useCallback((targetIndex?: number) => {
    const scrollContainer = document.querySelector('.timeline-scroll')
    const currentScrollTop = scrollContainer ? scrollContainer.scrollTop : undefined
    if (currentSelectedTokenRef.current && currentScrollTop != null) {
      sessionViewportsRef.current.set(currentSelectedTokenRef.current, {
        scrollTop: currentScrollTop,
        selectedEventId: currentSelectedEventIdRef.current,
      })
    }

    setSessionStack((prev) => {
      if (!prev.length) return prev
      const target = targetIndex != null ? targetIndex : prev.length - 1
      const frame = prev[target]
      if (!frame) return prev

      setSelectedToken(frame.token)
      setSelectedMetadata(frame.metadata)
      setParsedSession(frame.parsedSession)
      setSelectedLeafId(frame.selectedLeafId)
      setSelectedEventId(frame.selectedEventId)
      setImportedFile(frame.importedFile)
      currentContentRef.current = frame.rawContent
      setLoadError(null)

      setRestorePosition({
        eventId: frame.selectedEventId,
        scrollTop: frame.scrollTop,
        key: ++restoreKeyRef.current,
      })

      return prev.slice(0, target)
    })
  }, [])

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

  useEffect(() => {
    let cancelled = false
    reloadSessions().then((payload) => {
      if (cancelled || !payload || !payload.sessions.length) return
      const targetCwd = payload.currentCwd ?? currentCwd ?? browserInitialCwd()
      const initialSession = createSessionCatalog(payload.sessions, targetCwd).findInitialSession(targetCwd)
      if (initialSession) void openServerSession(initialSession)
    })
    return () => { cancelled = true }
  }, [currentCwd, openServerSession, reloadSessions])

  const view = useMemo(
    () => parsedSession ? buildSessionView(parsedSession, selectedLeafId) : null,
    [parsedSession, selectedLeafId],
  )

  useEffect(() => {
    if (!view) return
    if (!view.events.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(view.events[0]?.id ?? null)
    }
  }, [view, selectedEventId])

  const selectedEvent = useMemo(
    () => view?.events.find((event) => event.id === selectedEventId) ?? null,
    [view, selectedEventId],
  )

  const filteredTurns = useMemo(() => (
    view?.turns
      .map((turn) => ({ ...turn, events: turn.events.filter((event) => enabledKinds.has(event.kind)) }))
      .filter((turn) => turn.events.length > 0) ?? []
  ), [view, enabledKinds])

  async function refreshCurrent() {
    sessionViewportsRef.current.clear()
    const listPromise = reloadSessions()

    if (selectedToken && selectedMetadata) {
      setSessionLoading(true)
      try {
        const [sessionPayload, payload] = await Promise.all([
          accessToken ? fetchSession(selectedToken, accessToken) : Promise.reject(new Error(t.header.missingToken)),
          listPromise,
        ])
        const updatedMetadata = payload?.sessions.find((item) => item.token === selectedToken) ?? selectedMetadata
        applyContent(sessionPayload.content, sessionPayload.relativePath, updatedMetadata)
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error))
      } finally {
        setSessionLoading(false)
      }
      return
    }

    if (importedFile) {
      setSessionLoading(true)
      try {
        const [fileText] = await Promise.all([
          importedFile.text(),
          listPromise,
        ])
        applyContent(fileText, importedFile.name, null)
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error))
      } finally {
        setSessionLoading(false)
      }
      return
    }

    const payload = await listPromise
    if (payload && payload.sessions.length > 0) {
      const targetCwd = payload.currentCwd ?? currentCwd ?? browserInitialCwd()
      const initialSession = createSessionCatalog(payload.sessions, targetCwd).findInitialSession(targetCwd)
      if (initialSession) void openServerSession(initialSession)
    }
  }

  async function importFile(file: File) {
    sessionViewportsRef.current.clear()
    setSessionLoading(true)
    setImportedFile(file)
    setSelectedToken(null)
    setSidebarOpen(false)
    setSessionStack([])
    try {
      applyContent(await file.text(), file.name, null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionLoading(false)
    }
  }

  function toggleKind(kind: EventKind) {
    setEnabledKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  function toggleAllKinds() {
    setEnabledKinds((current) => {
      const allSelected = allEventKinds.length > 0 && allEventKinds.every((kind) => current.has(kind))
      return allSelected ? new Set() : new Set(allEventKinds)
    })
  }

  function selectEvent(event: TimelineEvent) {
    setSelectedEventId(event.id)
    setInspectorOpen(true)
  }

  const displayError = loadError ?? (!accessToken ? t.header.missingToken : null)
  const title = parsedSession ? getSessionTitle(parsedSession) : t.header.selectSession
  const fullJsonlPath = useMemo(() => {
    const rel = selectedMetadata?.relativePath || parsedSession?.sourceName || importedFile?.name || ''
    if (!rel) return ''
    if (rel.startsWith('/') || !sessionRoot) return rel
    const cleanRoot = sessionRoot.replace(/\/+$/, '')
    const cleanRel = rel.replace(/^\/+/, '')
    return `${cleanRoot}/${cleanRel}`
  }, [selectedMetadata?.relativePath, parsedSession?.sourceName, importedFile?.name, sessionRoot])

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
            <div className="breadcrumb-trail">
              <button
                type="button"
                className="breadcrumb-back-btn"
                onClick={() => popSessionStack()}
                title={t.header.backToParent}
                aria-label={t.header.backToParent}
              >
                <ArrowLeft size={15} />
                <span>{t.header.backToParent}</span>
              </button>
              <div className="breadcrumb-current" title={fullJsonlPath || title}>
                <span className="breadcrumb-badge"><Bot size={13} /> {t.header.subagentBadge}</span>
                <strong title={fullJsonlPath || title}>{title}</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="header-session" title={fullJsonlPath || undefined}>
            <strong title={fullJsonlPath || title}>{title}</strong>
            <span>{selectedMetadata?.cwd ?? parsedSession?.header?.cwd ?? t.header.noSessionLoaded}</span>
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
            onSelect={(session) => {
              setSessionStack([])
              void openServerSession(session)
            }}
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
              <section className="session-summary" aria-label={t.overview.sessionSummary}>
                <div><span>{t.overview.entries}</span><strong>{parsedSession.stats.entryCount}</strong></div>
                <div><span>{t.overview.turns}</span><strong>{parsedSession.stats.turnCount}</strong></div>
                <div><span>{t.overview.duration}</span><strong>{formatDuration(parsedSession.stats.elapsedMs)}</strong></div>
                <div><span>{t.overview.started}</span><strong>{formatDateTime(parsedSession.stats.startedAt)}</strong></div>
              </section>
              <Timeline
                session={parsedSession}
                turns={filteredTurns}
                allEvents={view.events}
                selectedEventId={selectedEventId}
                restorePosition={restorePosition}
                selectedLeafId={selectedLeafId}
                enabledKinds={enabledKinds}
                onSelectEvent={selectEvent}
                onSelectBranch={(leafId) => setSelectedLeafId(leafId)}
                onToggleKind={toggleKind}
                onToggleAllKinds={toggleAllKinds}
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
          mobileOpen={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
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
