import { allEventKinds, defaultEventKinds } from '../core/event-kinds'
import { findPreviousPromptSnapshot } from '../core/prompt-diff'
import { getSessionTitle } from '../core/session-parser'
import { buildSessionView, primaryEventForEntry } from '../core/session-view'
import type {
  ContextProjection,
  EventKind,
  ParsedSession,
  ProjectSummary,
  SessionFileResponse,
  SessionListItem,
  SessionListResponse,
  SessionView,
  SubagentReference,
  TimelineEvent,
  TimelineTurn,
} from '../core/types'
import { sessionCacheKey, type CachedSession, type SessionCache } from './session-cache'

export interface ImportedSessionSource<FileHandle = unknown> {
  name: string
  file: FileHandle
}

export interface SessionViewAnchor {
  eventId: string
  offset: number
}

export interface SessionViewViewport {
  scrollTop: number
  anchor: SessionViewAnchor | null
}

export type SessionViewSource<FileHandle = unknown> =
  | { kind: 'server'; token: string; modifiedAt: string }
  | { kind: 'file'; imported: ImportedSessionSource<FileHandle> }

export interface ActiveSessionView<FileHandle = unknown> {
  token: string | null
  metadata: SessionListItem | null
  source: SessionViewSource<FileHandle>
  parsed: ParsedSession
  contextProjections: Record<string, ContextProjection> | null
}

export interface SessionViewRestoreIntent {
  eventId: string | null
  scrollTop?: number
  anchor?: SessionViewAnchor
  revealEventKind?: boolean
  key: number
}

export type SessionViewError =
  | { code: 'missing-token' }
  | { code: 'invalid-session' }
  | { code: 'subagent-transcript-only' }
  | { code: 'operation-failed' }

export interface SessionNavigationFrame<FileHandle = unknown> {
  token: string | null
  metadata: SessionListItem | null
  source: SessionViewSource<FileHandle>
  selectedLeafId: string | null
  selectedEventId: string | null
  scrollTop: number
  timelineAnchor: SessionViewAnchor | null
}

export interface SessionCatalogState {
  projects: ProjectSummary[]
  sessions: SessionListItem[]
  root: string
  currentCwd: string | null
  scopeMode: 'current' | 'all'
  selectedProjectCwd: string | null
  loading: boolean
  warnings: string[]
}

export interface SessionViewSnapshot<FileHandle = unknown> {
  active: ActiveSessionView<FileHandle> | null
  view: SessionView | null
  contextProjection: ContextProjection | undefined
  selectedLeafId: string | null
  selectedEventId: string | null
  enabledKinds: ReadonlySet<EventKind>
  loading: boolean
  loadError: SessionViewError | null
  actionError: SessionViewError | null
  navigation: readonly SessionNavigationFrame<FileHandle>[]
  restoreIntent: SessionViewRestoreIntent | null
  loadedAt: string | null
  visibleTurns: TimelineTurn[]
  selectedEvent: TimelineEvent | null
  previousPrompt: string | undefined
  sessionTitle: string | null
  catalog: SessionCatalogState
  fullJsonlPath: string
}

export type SessionViewIntent<FileHandle = unknown> =
  | { type: 'load-catalog'; autoOpen?: boolean }
  | { type: 'set-scope-mode'; mode: 'current' | 'all' }
  | { type: 'set-project-filter'; cwd: string | null }
  | { type: 'open'; session: SessionListItem }
  | { type: 'import'; source: ImportedSessionSource<FileHandle> }
  | { type: 'refresh'; viewport?: SessionViewViewport | null }
  | { type: 'open-subagent'; reference: SubagentReference; sourceEventId?: string; viewport?: SessionViewViewport | null }
  | { type: 'return-to-parent'; targetIndex?: number; viewport?: SessionViewViewport | null }
  | { type: 'select-event'; eventId: string }
  | { type: 'jump-to-event'; eventId: string }
  | { type: 'jump-to-entry'; entryId: string }
  | { type: 'select-branch'; leafId: string }
  | { type: 'toggle-event-kind'; kind: EventKind }
  | { type: 'toggle-all-event-kinds' }
  | { type: 'ensure-event-kind'; kind: EventKind }
  | { type: 'acknowledge-timeline-restore'; key: number }
  | { type: 'dismiss-action-error' }

export interface SessionViewControllerDependencies<FileHandle = unknown> {
  readServerSession(token: string): Promise<SessionFileResponse>
  resolveSubagent(targetFile: string, parentRelative?: string): Promise<SessionFileResponse>
  readImportedFile(source: ImportedSessionSource<FileHandle>): Promise<string>
  refreshCatalog(): Promise<SessionListResponse | null>
  cache: SessionCache
  parseSession(content: string, sourceName: string): ParsedSession
  buildView?(parsed: ParsedSession, leafId?: string | null, projection?: ContextProjection): SessionView
  now(): string
  initialCwd?: string | null
  autoLoadCatalog?: boolean
}

export interface SessionViewController<FileHandle = unknown> {
  getSnapshot(): SessionViewSnapshot<FileHandle>
  subscribe(listener: () => void): () => void
  dispatch(intent: SessionViewIntent<FileHandle>): Promise<void>
}

type SessionParser = SessionViewControllerDependencies<unknown>['parseSession']

interface RememberedSessionView {
  selectedLeafId: string | null
  selectedEventId: string | null
  viewport: SessionViewViewport
}

function failed(): SessionViewError {
  return { code: 'operation-failed' }
}

function parsedIsSession(parsed: ParsedSession): boolean {
  return parsed.header?.type === 'session'
}

function requirePiSession(parsed: ParsedSession): ParsedSession {
  if (!parsedIsSession(parsed)) throw { code: 'invalid-session' } satisfies SessionViewError
  return parsed
}

function parsePiSession(parseSession: SessionParser, content: string, sourceName: string): ParsedSession {
  return requirePiSession(parseSession(content, sourceName))
}

function enableEventKind(enabledKinds: ReadonlySet<EventKind>, kind: EventKind): ReadonlySet<EventKind> {
  if (enabledKinds.has(kind)) return enabledKinds
  const next = new Set(enabledKinds)
  next.add(kind)
  return next
}

function activeView(
  parsed: ParsedSession,
  contextProjections: Record<string, ContextProjection> | null,
  leafId: string | null,
  buildView: (parsed: ParsedSession, leafId?: string | null, projection?: ContextProjection) => SessionView,
): { leafId: string | null; view: SessionView; projection: ContextProjection | undefined } {
  const selectedLeafId = leafId && parsed.branches.some((branch) => branch.leafId === leafId)
    ? leafId
    : parsed.currentLeafId
  const projection = selectedLeafId ? contextProjections?.[selectedLeafId] : undefined
  return {
    leafId: selectedLeafId,
    view: buildView(parsed, selectedLeafId, projection),
    projection,
  }
}

function selectedEventFor(view: SessionView, requestedEventId: string | null): string | null {
  return requestedEventId && view.events.some((event) => event.id === requestedEventId)
    ? requestedEventId
    : view.events[0]?.id ?? null
}

function reconcile(
  parsed: ParsedSession,
  projections: Record<string, ContextProjection> | null,
  requestedLeafId: string | null,
  requestedEventId: string | null,
  buildView: (parsed: ParsedSession, leafId?: string | null, projection?: ContextProjection) => SessionView,
) {
  const selected = activeView(parsed, projections, requestedLeafId, buildView)
  return {
    selectedLeafId: selected.leafId,
    view: selected.view,
    contextProjection: selected.projection,
    selectedEventId: selectedEventFor(selected.view, requestedEventId),
  }
}

function cachedSession<FileHandle>(
  token: string,
  modifiedAt: string,
  cached: CachedSession,
  metadata: SessionListItem,
): ActiveSessionView<FileHandle> {
  return {
    token,
    metadata,
    source: { kind: 'server', token, modifiedAt },
    parsed: cached.parsed,
    contextProjections: cached.contextProjections,
  }
}

function rememberSession(
  cache: SessionCache,
  token: string,
  modifiedAt: string,
  content: string,
  parsed: ParsedSession,
  contextProjections: Record<string, ContextProjection> | null,
): void {
  cache.remember(sessionCacheKey(token, modifiedAt), {
    token,
    modifiedAt,
    content,
    parsed,
    contextProjections,
  })
}

function computeFullJsonlPath<FileHandle>(
  active: ActiveSessionView<FileHandle> | null,
  sessionRoot: string,
): string {
  if (!active) return ''
  const importedName = active.source.kind === 'file' ? active.source.imported.name : ''
  const rel = active.metadata?.relativePath || active.parsed.sourceName || importedName || ''
  if (!rel) return ''
  if (rel.startsWith('/') || !sessionRoot) return rel
  const cleanRoot = sessionRoot.replace(/\/+$/, '')
  const cleanRel = rel.replace(/^\/+/, '')
  return `${cleanRoot}/${cleanRel}`
}

function deriveSnapshot<FileHandle>(
  base: Omit<
    SessionViewSnapshot<FileHandle>,
    'visibleTurns' | 'selectedEvent' | 'previousPrompt' | 'sessionTitle' | 'fullJsonlPath'
  >,
): SessionViewSnapshot<FileHandle> {
  const selectedEvent = base.view && base.selectedEventId
    ? base.view.events.find((event) => event.id === base.selectedEventId) ?? null
    : null
  const previousPrompt = base.view && selectedEvent?.kind === 'system-prompt'
    ? findPreviousPromptSnapshot(base.view.events, selectedEvent.id)
    : undefined
  const visibleTurns: TimelineTurn[] = base.view
    ? base.view.turns
        .map((turn) => ({ ...turn, events: turn.events.filter((event) => base.enabledKinds.has(event.kind)) }))
        .filter((turn) => turn.events.length > 0)
    : []
  const sessionTitle = base.active ? getSessionTitle(base.active.parsed) : null
  const fullJsonlPath = computeFullJsonlPath(base.active, base.catalog.root)

  return {
    ...base,
    visibleTurns,
    selectedEvent,
    previousPrompt,
    sessionTitle,
    fullJsonlPath,
  }
}

export function createSessionViewController<FileHandle = unknown>(
  dependencies: SessionViewControllerDependencies<FileHandle>,
): SessionViewController<FileHandle> {
  const buildView = dependencies.buildView ?? buildSessionView
  let snapshot: SessionViewSnapshot<FileHandle> = deriveSnapshot({
    active: null,
    view: null,
    contextProjection: undefined,
    selectedLeafId: null,
    selectedEventId: null,
    enabledKinds: new Set(defaultEventKinds),
    loading: false,
    loadError: null,
    actionError: null,
    navigation: [],
    restoreIntent: null,
    loadedAt: null,
    catalog: {
      projects: [],
      sessions: [],
      root: '',
      currentCwd: dependencies.initialCwd ?? null,
      scopeMode: 'current',
      selectedProjectCwd: null,
      loading: dependencies.autoLoadCatalog ?? false,
      warnings: [],
    },
  })
  let latestSessionChange = 0
  let restoreKey = 0
  const listeners = new Set<() => void>()
  const rememberedViewports = new Map<string, RememberedSessionView>()

  const publish = (
    next: Omit<
      SessionViewSnapshot<FileHandle>,
      'visibleTurns' | 'selectedEvent' | 'previousPrompt' | 'sessionTitle' | 'fullJsonlPath'
    >,
  ) => {
    snapshot = deriveSnapshot(next)
    for (const listener of listeners) listener()
  }

  const update = (changes: Partial<SessionViewSnapshot<FileHandle>>) => {
    publish({ ...snapshot, ...changes })
  }

  const beginSessionChange = (): number => {
    const sequence = ++latestSessionChange
    update({ loading: true, loadError: null, actionError: null })
    return sequence
  }

  const isLatest = (sequence: number) => sequence === latestSessionChange

  const makeRestore = (
    eventId: string | null,
    scrollTop?: number,
    anchor?: SessionViewAnchor | null,
    revealEventKind = false,
  ): SessionViewRestoreIntent => ({
    eventId,
    scrollTop,
    anchor: anchor ?? undefined,
    revealEventKind,
    key: ++restoreKey,
  })

  const rememberViewport = (token: string, position: RememberedSessionView) => {
    rememberedViewports.delete(token)
    rememberedViewports.set(token, position)
    if (rememberedViewports.size > 12) {
      const oldestToken = rememberedViewports.keys().next().value
      if (oldestToken) rememberedViewports.delete(oldestToken)
    }
  }

  const commit = (
    active: ActiveSessionView<FileHandle>,
    requestedLeafId: string | null,
    requestedEventId: string | null,
    restoreIntent: SessionViewRestoreIntent | null,
    navigation: readonly SessionNavigationFrame<FileHandle>[] = snapshot.navigation,
  ) => {
    const selected = reconcile(active.parsed, active.contextProjections, requestedLeafId, requestedEventId, buildView)
    publish({
      ...snapshot,
      active,
      ...selected,
      loading: false,
      navigation,
      restoreIntent,
      loadedAt: dependencies.now(),
      loadError: null,
      actionError: null,
    })
  }

  const dispatchOpen = async (session: SessionListItem) => {
    const sequence = beginSessionChange()
    try {
      const key = sessionCacheKey(session.token, session.modifiedAt)
      const cached = dependencies.cache.recall(key)
      let active: ActiveSessionView<FileHandle>
      if (cached) {
        active = cachedSession(session.token, session.modifiedAt, cached, session)
      } else {
        const payload = await dependencies.readServerSession(session.token)
        if (!isLatest(sequence)) return
        const parsed = parsePiSession(dependencies.parseSession, payload.content, payload.relativePath)
        const contextProjections = payload.contextProjections ?? null
        const metadata = { ...session, modifiedAt: payload.modifiedAt, relativePath: payload.relativePath }
        active = {
          token: session.token,
          metadata,
          source: { kind: 'server', token: session.token, modifiedAt: payload.modifiedAt },
          parsed,
          contextProjections,
        }
        rememberSession(dependencies.cache, session.token, payload.modifiedAt, payload.content, parsed, contextProjections)
      }
      if (!isLatest(sequence)) return
      requirePiSession(active.parsed)
      commit(active, active.parsed.currentLeafId, null, makeRestore(null, 0), [])
    } catch (error) {
      if (!isLatest(sequence)) return
      update({ loading: false, loadError: isControllerError(error) ? error : failed() })
    }
  }

  const dispatchImport = async (source: ImportedSessionSource<FileHandle>) => {
    const sequence = beginSessionChange()
    try {
      const content = await dependencies.readImportedFile(source)
      if (!isLatest(sequence)) return
      const parsed = parsePiSession(dependencies.parseSession, content, source.name)
      const active: ActiveSessionView<FileHandle> = {
        token: null,
        metadata: null,
        source: { kind: 'file', imported: source },
        parsed,
        contextProjections: null,
      }
      commit(active, parsed.currentLeafId, null, makeRestore(null, 0), [])
    } catch (error) {
      if (!isLatest(sequence)) return
      update({ loading: false, loadError: isControllerError(error) ? error : failed() })
    }
  }

  const applyCatalog = (payload: SessionListResponse | null, error?: unknown) => {
    if (error) {
      update({
        catalog: {
          ...snapshot.catalog,
          loading: false,
          warnings: [error instanceof Error ? error.message : String(error)],
        },
      })
      return
    }
    if (payload) {
      update({
        catalog: {
          ...snapshot.catalog,
          projects: payload.projects,
          sessions: payload.sessions,
          root: payload.root,
          warnings: payload.warnings,
          currentCwd: snapshot.catalog.currentCwd ?? payload.currentCwd ?? null,
          loading: false,
        },
      })
    } else {
      update({
        catalog: {
          ...snapshot.catalog,
          loading: false,
        },
      })
    }
  }

  const dispatchLoadCatalog = async (autoOpen = false) => {
    update({ catalog: { ...snapshot.catalog, loading: true } })
    let payload: SessionListResponse | null = null
    try {
      payload = await dependencies.refreshCatalog()
      applyCatalog(payload)
    } catch (error) {
      applyCatalog(null, error)
      return
    }

    if (autoOpen && payload && payload.sessions.length > 0) {
      if (!snapshot.active && !snapshot.loading) {
        const initialSession = payload.initialSessionToken
          ? payload.sessions.find((s) => s.token === payload.initialSessionToken)
          : payload.sessions[0]
        if (initialSession) {
          await dispatchOpen(initialSession)
        }
      }
    }
  }

  const dispatchRefresh = async (viewport?: SessionViewViewport | null) => {
    const sequence = beginSessionChange()
    const activeAtStart = snapshot.active
    update({ catalog: { ...snapshot.catalog, loading: true } })

    let catalogError: unknown = null
    const catalogPromise = Promise.resolve()
      .then(() => dependencies.refreshCatalog())
      .catch((err) => {
        catalogError = err
        return null
      })

    if (!activeAtStart) {
      const catalog = await catalogPromise
      if (!isLatest(sequence)) return
      applyCatalog(catalog, catalogError)
      if (!snapshot.active && catalog && catalog.sessions.length > 0) {
        const initial = catalog.initialSessionToken
          ? catalog.sessions.find((s) => s.token === catalog.initialSessionToken)
          : catalog.sessions[0]
        if (initial) {
          await dispatchOpen(initial)
          return
        }
      }
      update({ loading: false })
      return
    }

    try {
      if (activeAtStart.source.kind === 'file') {
        const [content, fetchedCatalog] = await Promise.all([
          dependencies.readImportedFile(activeAtStart.source.imported),
          catalogPromise,
        ])
        if (!isLatest(sequence)) return
        applyCatalog(fetchedCatalog, catalogError)
        const parsed = parsePiSession(dependencies.parseSession, content, activeAtStart.source.imported.name)
        const active = { ...activeAtStart, parsed }
        const selected = reconcile(parsed, null, snapshot.selectedLeafId, snapshot.selectedEventId, buildView)
        const restoreIntent = makeRestore(selected.selectedEventId, viewport?.scrollTop, viewport?.anchor)
        commit(active, selected.selectedLeafId, selected.selectedEventId, restoreIntent)
        return
      }

      const serverSource = activeAtStart.source
      if (serverSource.kind !== 'server') throw new Error('Unsupported Session source')
      const catalog = await catalogPromise
      if (!isLatest(sequence)) return
      applyCatalog(catalog, catalogError)

      const listedMetadata = catalog?.sessions.find((item) => item.token === serverSource.token)
      if (listedMetadata && listedMetadata.modifiedAt === serverSource.modifiedAt) {
        publish({ ...snapshot, active: { ...activeAtStart, metadata: listedMetadata }, loading: false, loadError: null })
        return
      }

      const payload = await dependencies.readServerSession(serverSource.token)
      if (!isLatest(sequence)) return
      const parsed = parsePiSession(dependencies.parseSession, payload.content, payload.relativePath)
      const contextProjections = payload.contextProjections ?? null
      const metadata = {
        ...(listedMetadata ?? activeAtStart.metadata!),
        modifiedAt: payload.modifiedAt,
        relativePath: payload.relativePath,
      }
      const active: ActiveSessionView<FileHandle> = {
        token: serverSource.token,
        metadata,
        source: { kind: 'server', token: serverSource.token, modifiedAt: payload.modifiedAt },
        parsed,
        contextProjections,
      }
      rememberSession(dependencies.cache, serverSource.token, payload.modifiedAt, payload.content, parsed, contextProjections)
      const selected = reconcile(parsed, contextProjections, snapshot.selectedLeafId, snapshot.selectedEventId, buildView)
      const restoreIntent = makeRestore(selected.selectedEventId, viewport?.scrollTop, viewport?.anchor)
      commit(active, selected.selectedLeafId, selected.selectedEventId, restoreIntent)
    } catch (error) {
      if (!isLatest(sequence)) return
      update({ loading: false, loadError: isControllerError(error) ? error : failed() })
    }
  }

  const dispatchSubagent = async (
    reference: SubagentReference,
    sourceEventId?: string,
    viewport?: SessionViewViewport | null,
  ) => {
    const parent = snapshot.active
    if (!parent) return
    const sequence = beginSessionChange()
    const parentFrame = createFrame(snapshot, viewport, sourceEventId)

    try {
      const parentRelative = parent.metadata?.relativePath ?? parent.parsed.sourceName
      let token: string
      let relativePath: string
      let modifiedAt: string
      let parsed: ParsedSession
      let contextProjections: Record<string, ContextProjection> | null

      const cached = dependencies.cache.recallByToken(reference.token)
      if (cached && parsedIsSession(cached.parsed)) {
        token = cached.token
        relativePath = cached.parsed.sourceName
        modifiedAt = cached.modifiedAt
        parsed = cached.parsed
        contextProjections = cached.contextProjections
      } else {
        const payload = await dependencies.resolveSubagent(reference.targetFile, parentRelative)
        if (!isLatest(sequence)) return
        token = payload.token
        relativePath = payload.relativePath
        modifiedAt = payload.modifiedAt
        parsed = parsePiSession(dependencies.parseSession, payload.content, payload.relativePath)
        contextProjections = payload.contextProjections ?? null
        rememberSession(
          dependencies.cache,
          token,
          payload.modifiedAt,
          payload.content,
          parsed,
          contextProjections,
        )
        if (reference.token !== token) {
          rememberSession(
            dependencies.cache,
            reference.token,
            payload.modifiedAt,
            payload.content,
            parsed,
            contextProjections,
          )
        }
      }

      const metadata: SessionListItem = {
        token,
        id: reference.targetFile,
        title: reference.agentName ? `${reference.agentName} (Subagent)` : `Subagent (${relativePath})`,
        cwd: parent.metadata?.cwd ?? parent.parsed.header?.cwd ?? '',
        modifiedAt,
        relativePath,
        parentSession: parent.parsed.header?.id,
      }
      const active: ActiveSessionView<FileHandle> = {
        token,
        metadata,
        source: { kind: 'server', token, modifiedAt },
        parsed,
        contextProjections,
      }
      const remembered = rememberedViewports.get(token)
      const selected = reconcile(
        active.parsed,
        active.contextProjections,
        remembered?.selectedLeafId ?? active.parsed.currentLeafId,
        remembered?.selectedEventId ?? null,
        buildView,
      )
      const restoreIntent = remembered
        ? makeRestore(selected.selectedEventId, remembered.viewport.scrollTop, remembered.viewport.anchor)
        : makeRestore(null, 0)
      commit(active, selected.selectedLeafId, selected.selectedEventId, restoreIntent, [...snapshot.navigation, parentFrame])
    } catch (error) {
      if (!isLatest(sequence)) return
      const failure = isControllerError(error) ? error : failed()
      update({ loading: false, actionError: failure })
    }
  }

  const dispatchReturn = async (targetIndex?: number, viewport?: SessionViewViewport | null) => {
    if (!snapshot.navigation.length) return
    const sequence = beginSessionChange()
    const current = snapshot.active
    if (current?.token && viewport) {
      rememberViewport(current.token, {
        selectedLeafId: snapshot.selectedLeafId,
        selectedEventId: snapshot.selectedEventId,
        viewport,
      })
    }
    const index = targetIndex ?? snapshot.navigation.length - 1
    const frame = snapshot.navigation[index]
    if (!frame) {
      update({ loading: false })
      return
    }
    try {
      let parsed: ParsedSession
      let contextProjections: Record<string, ContextProjection> | null
      let metadata = frame.metadata
      let source = frame.source

      if (frame.source.kind === 'file') {
        const content = await dependencies.readImportedFile(frame.source.imported)
        if (!isLatest(sequence)) return
        parsed = parsePiSession(dependencies.parseSession, content, frame.source.imported.name)
        contextProjections = null
      } else {
        const cached = dependencies.cache.recall(sessionCacheKey(frame.source.token, frame.source.modifiedAt))
        if (cached) {
          parsed = cached.parsed
          contextProjections = cached.contextProjections
        } else {
          const payload = await dependencies.readServerSession(frame.source.token)
          if (!isLatest(sequence)) return
          parsed = parsePiSession(dependencies.parseSession, payload.content, payload.relativePath)
          contextProjections = payload.contextProjections ?? null
          metadata = metadata ? { ...metadata, modifiedAt: payload.modifiedAt, relativePath: payload.relativePath } : null
          source = { kind: 'server', token: frame.source.token, modifiedAt: payload.modifiedAt }
          rememberSession(
            dependencies.cache,
            frame.source.token,
            payload.modifiedAt,
            payload.content,
            parsed,
            contextProjections,
          )
        }
      }
      requirePiSession(parsed)
      if (!isLatest(sequence)) return

      const active: ActiveSessionView<FileHandle> = {
        token: frame.token,
        metadata,
        source,
        parsed,
        contextProjections,
      }
      const selected = reconcile(parsed, contextProjections, frame.selectedLeafId, frame.selectedEventId, buildView)
      const anchorExists = frame.timelineAnchor && selected.view.events.some((event) => event.id === frame.timelineAnchor?.eventId)
      const restoreIntent = makeRestore(
        selected.selectedEventId,
        frame.scrollTop,
        anchorExists ? frame.timelineAnchor : undefined,
      )
      const navigation = snapshot.navigation.slice(0, index)
      commit(active, selected.selectedLeafId, selected.selectedEventId, restoreIntent, navigation)
    } catch (error) {
      if (!isLatest(sequence)) return
      update({ loading: false, loadError: isControllerError(error) ? error : failed() })
    }
  }

  const setSelectedEvent = (eventId: string, jump: boolean) => {
    const event = snapshot.view?.events.find((candidate) => candidate.id === eventId)
    if (!event) return
    const enabledKinds = jump ? enableEventKind(snapshot.enabledKinds, event.kind) : snapshot.enabledKinds
    update({
      selectedEventId: eventId,
      enabledKinds,
      restoreIntent: jump ? makeRestore(eventId, undefined, undefined, true) : snapshot.restoreIntent,
    })
  }

  const dispatch = async (intent: SessionViewIntent<FileHandle>) => {
    switch (intent.type) {
      case 'load-catalog': return dispatchLoadCatalog(intent.autoOpen)
      case 'set-scope-mode': {
        update({ catalog: { ...snapshot.catalog, scopeMode: intent.mode } })
        return
      }
      case 'set-project-filter': {
        update({ catalog: { ...snapshot.catalog, selectedProjectCwd: intent.cwd } })
        return
      }
      case 'open': return dispatchOpen(intent.session)
      case 'import': return dispatchImport(intent.source)
      case 'refresh': return dispatchRefresh(intent.viewport)
      case 'open-subagent': return dispatchSubagent(intent.reference, intent.sourceEventId, intent.viewport)
      case 'return-to-parent': return dispatchReturn(intent.targetIndex, intent.viewport)
      case 'select-event': setSelectedEvent(intent.eventId, false); return
      case 'jump-to-event': setSelectedEvent(intent.eventId, true); return
      case 'jump-to-entry': {
        const events = snapshot.view?.events.filter((event) => event.entryId === intent.entryId) ?? []
        const target = primaryEventForEntry(events)
        if (!target) return
        setSelectedEvent(target.id, true)
        return
      }
      case 'select-branch': {
        const active = snapshot.active
        if (!active || !active.parsed.branches.some((branch) => branch.leafId === intent.leafId)) return
        const selected = activeView(active.parsed, active.contextProjections, intent.leafId, buildView)
        const currentEvent = selected.view.events.some((event) => event.id === snapshot.selectedEventId)
          ? snapshot.selectedEventId
          : selected.view.events[0]?.id ?? null
        update({
          selectedLeafId: selected.leafId,
          view: selected.view,
          contextProjection: selected.projection,
          selectedEventId: currentEvent,
          restoreIntent: currentEvent === snapshot.selectedEventId
            ? snapshot.restoreIntent
            : makeRestore(currentEvent),
        })
        return
      }
      case 'toggle-event-kind': {
        const enabledKinds = new Set(snapshot.enabledKinds)
        if (enabledKinds.has(intent.kind)) enabledKinds.delete(intent.kind)
        else enabledKinds.add(intent.kind)
        update({ enabledKinds })
        return
      }
      case 'toggle-all-event-kinds': {
        const allSelected = allEventKinds.every((kind) => snapshot.enabledKinds.has(kind))
        update({ enabledKinds: allSelected ? new Set() : new Set(allEventKinds) })
        return
      }
      case 'ensure-event-kind': {
        if (snapshot.enabledKinds.has(intent.kind)) return
        const enabledKinds = new Set(snapshot.enabledKinds)
        enabledKinds.add(intent.kind)
        update({ enabledKinds })
        return
      }
      case 'acknowledge-timeline-restore':
        if (snapshot.restoreIntent?.key === intent.key) update({ restoreIntent: null })
        return
      case 'dismiss-action-error': update({ actionError: null }); return
    }
  }

  if (dependencies.autoLoadCatalog) {
    void dispatchLoadCatalog(true)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch,
  }
}

function createFrame<FileHandle>(
  snapshot: SessionViewSnapshot<FileHandle>,
  viewport: SessionViewViewport | null | undefined,
  sourceEventId?: string,
): SessionNavigationFrame<FileHandle> {
  const active = snapshot.active!
  return {
    token: active.token,
    metadata: active.metadata,
    source: active.source,
    selectedLeafId: snapshot.selectedLeafId,
    selectedEventId: snapshot.selectedEventId,
    scrollTop: viewport?.scrollTop ?? 0,
    timelineAnchor: viewport?.anchor ?? (sourceEventId ? { eventId: sourceEventId, offset: 0 } : null),
  }
}

function isControllerError(error: unknown): error is SessionViewError {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = (error as { code?: unknown }).code
  return code === 'missing-token'
    || code === 'invalid-session'
    || code === 'subagent-transcript-only'
    || code === 'operation-failed'
}
