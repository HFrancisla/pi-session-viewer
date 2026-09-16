import { AlertCircle, Clock3, Menu, PanelRightOpen, RefreshCw, Rows3 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSession, fetchSessions } from './api'
import { Inspector } from './components/Inspector'
import { SessionSidebar } from './components/SessionSidebar'
import { Timeline } from './components/Timeline'
import { allEventKinds } from '../core/event-kinds'
import { formatDateTime, formatDuration } from '../core/format'
import { buildSessionView, getSessionTitle, parseSessionJsonl } from '../core/session-parser'
import { browserAccessToken } from './session-auth'
import type { EventKind, ParsedSession, SessionListItem, TimelineEvent } from '../core/types'

function App() {
  const [accessToken] = useState<string | null>(() => browserAccessToken())
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [sessionRoot, setSessionRoot] = useState('')
  const [listWarnings, setListWarnings] = useState<string[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [loadError, setLoadError] = useState(() => accessToken ? '' : '缺少面板访问令牌，请从 Pi 执行 /session-viewer on 后打开链接。')
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [selectedMetadata, setSelectedMetadata] = useState<SessionListItem | null>(null)
  const [parsedSession, setParsedSession] = useState<ParsedSession | null>(null)
  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [enabledKinds, setEnabledKinds] = useState<Set<EventKind>>(() => new Set(allEventKinds))
  const [importedFile, setImportedFile] = useState<File | null>(null)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const applyContent = useCallback((content: string, sourceName: string, metadata: SessionListItem | null) => {
    const parsed = parseSessionJsonl(content, sourceName)
    setParsedSession(parsed)
    setSelectedMetadata(metadata)
    setSelectedLeafId(parsed.currentLeafId)
    setSelectedEventId(null)
    setLoadedAt(new Date().toISOString())
    setLoadError('')
  }, [])

  const openServerSession = useCallback(async (session: SessionListItem) => {
    if (!accessToken) return
    setSessionLoading(true)
    setSelectedToken(session.token)
    setImportedFile(null)
    setSidebarOpen(false)
    try {
      const payload = await fetchSession(session.token, accessToken)
      applyContent(payload.content, payload.relativePath, session)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionLoading(false)
    }
  }, [accessToken, applyContent])

  useEffect(() => {
    let cancelled = false
    if (!accessToken) {
      setListLoading(false)
      return () => { cancelled = true }
    }
    setListLoading(true)
    fetchSessions(accessToken)
      .then((payload) => {
        if (cancelled) return
        setSessions(payload.sessions)
        setSessionRoot(payload.root)
        setListWarnings(payload.warnings)
        if (payload.sessions[0]) void openServerSession(payload.sessions[0])
      })
      .catch((error: unknown) => {
        if (!cancelled) setListWarnings([error instanceof Error ? error.message : String(error)])
      })
      .finally(() => {
        if (!cancelled) setListLoading(false)
      })
    return () => { cancelled = true }
  }, [openServerSession])

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
    if (selectedToken && selectedMetadata) {
      await openServerSession(selectedMetadata)
      return
    }
    if (importedFile) {
      setSessionLoading(true)
      try {
        applyContent(await importedFile.text(), importedFile.name, null)
      } finally {
        setSessionLoading(false)
      }
    }
  }

  async function importFile(file: File) {
    setSessionLoading(true)
    setImportedFile(file)
    setSelectedToken(null)
    setSidebarOpen(false)
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

  function selectEvent(event: TimelineEvent) {
    setSelectedEventId(event.id)
    setInspectorOpen(true)
  }

  const title = parsedSession ? getSessionTitle(parsedSession) : '选择一个会话'

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="icon-button mobile-only" type="button" onClick={() => { setInspectorOpen(false); setSidebarOpen(true) }} title="打开会话列表" aria-label="打开会话列表">
          <Menu size={19} />
        </button>
        <div className="product-mark" aria-label="Pi 会话分析">
          <span className="product-glyph"><Rows3 size={18} /></span>
          <strong>Pi 会话分析</strong>
        </div>
        <div className="header-session">
          <strong>{title}</strong>
          <span>{selectedMetadata?.cwd ?? parsedSession?.header?.cwd ?? '尚未加载记录'}</span>
        </div>
        <div className="header-actions">
          {loadedAt && <span className="loaded-at"><Clock3 size={14} />{formatDateTime(loadedAt)} 已加载</span>}
          <button className="icon-button" type="button" onClick={() => void refreshCurrent()} disabled={!parsedSession || sessionLoading} title="重新读取会话" aria-label="重新读取会话">
            <RefreshCw className={sessionLoading ? 'spin' : ''} size={18} />
          </button>
          <button className="icon-button mobile-only" type="button" onClick={() => { setSidebarOpen(false); setInspectorOpen(true) }} title="打开详情" aria-label="打开详情">
            <PanelRightOpen size={19} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <div className={`sidebar-layer${sidebarOpen ? ' is-open' : ''}`}>
          <SessionSidebar
            sessions={sessions}
            selectedToken={selectedToken}
            root={sessionRoot}
            loading={listLoading}
            warnings={listWarnings}
            onSelect={(session) => void openServerSession(session)}
            onImport={() => fileInput.current?.click()}
          />
        </div>

        <main className="main-stage">
          {loadError ? (
            <div className="load-state is-error" role="alert">
              <AlertCircle size={28} />
              <h1>无法打开会话</h1>
              <p>{loadError}</p>
            </div>
          ) : parsedSession && view ? (
            <>
              <section className="session-summary" aria-label="会话概览">
                <div><span>入口</span><strong>{parsedSession.stats.entryCount}</strong></div>
                <div><span>轮次</span><strong>{parsedSession.stats.turnCount}</strong></div>
                <div><span>总跨度</span><strong>{formatDuration(parsedSession.stats.elapsedMs)}</strong></div>
                <div><span>开始</span><strong>{formatDateTime(parsedSession.stats.startedAt)}</strong></div>
              </section>
              <Timeline
                session={parsedSession}
                turns={filteredTurns}
                allEvents={view.events}
                selectedEventId={selectedEventId}
                selectedLeafId={selectedLeafId}
                enabledKinds={enabledKinds}
                onSelectEvent={selectEvent}
                onSelectBranch={(leafId) => setSelectedLeafId(leafId)}
                onToggleKind={toggleKind}
              />
            </>
          ) : (
            <div className="load-state">
              <Rows3 size={30} />
              <h1>{sessionLoading ? '正在读取会话' : '打开一次 Pi 会话'}</h1>
              <p>{sessionLoading ? '正在恢复入口树和调用关系。' : '从左侧选择本地记录，或打开一个 JSONL 文件。'}</p>
            </div>
          )}
        </main>

        <Inspector event={selectedEvent} mobileOpen={inspectorOpen} onClose={() => setInspectorOpen(false)} />
      </div>

      {(sidebarOpen || inspectorOpen) && <button className="mobile-backdrop" type="button" onClick={() => { setSidebarOpen(false); setInspectorOpen(false) }} aria-label="关闭浮层" />}

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
