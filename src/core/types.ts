// Shared domain types for the parser, server, and web application.
export type RawObject = Record<string, unknown>

export interface ParseWarning {
  code:
    | 'invalid-json'
    | 'invalid-header'
    | 'invalid-entry'
    | 'duplicate-id'
    | 'missing-parent'
    | 'cycle'
    | 'unknown-type'
  message: string
  line?: number
}

export interface SessionHeader extends RawObject {
  type: 'session'
  version?: number
  id?: string
  timestamp?: string
  cwd?: string
  parentSession?: string
}

export interface ParsedEntry {
  id: string
  parentId: string | null
  type: string
  timestamp?: string
  line: number
  raw: RawObject
}

export interface BranchOption {
  leafId: string
  label: string
  timestamp?: string
  isCurrent: boolean
}

export type EventKind = 'system-prompt' | 'tool-definitions' | 'user' | 'assistant' | 'thinking' | 'tool-call' | 'tool-result' | 'system'

export interface ToolSourceInfo {
  path?: string
  source?: string
  scope?: string
  origin?: string
  baseDir?: string
  [key: string]: unknown
}

export interface CapturedToolDefinition {
  name: string
  description?: string
  parameters?: unknown
  promptGuidelines?: string[]
  sourceInfo?: ToolSourceInfo
  [key: string]: unknown
}

export interface SystemPromptComposition {
  customPrompt?: string
  selectedTools: string[]
  toolSnippets: Record<string, string>
  toolDefinitions?: CapturedToolDefinition[]
  promptGuidelines: string[]
  appendSystemPrompt?: string
  cwd: string
  contextFiles: Array<{ path: string; content: string }>
  skills: Array<{
    name: string
    description: string
    filePath: string
    baseDir?: string
    disableModelInvocation?: boolean
  }>
}

export interface SystemPromptCapture {
  promptHash?: string
  recordType: 'snapshot' | 'reference' | 'missing'
  captureStage?: 'agent_start' | 'provider_request_update'
  /** What started the Pi run that produced this capture. */
  messageType?: 'user' | 'custom'
  promptLength?: number
  composition?: SystemPromptComposition
  promptBeforeFinalExtensions?: string
  capturedAt?: string
  sequence?: number
  model?: { provider?: string; id?: string }
  /** Version of the Pi process that produced this snapshot. */
  piVersion?: string
}

export interface SubagentReference {
  targetFile: string
  token: string
  agentName?: string
  task?: string
  sessionName?: string
  runId?: string
}

/**
 * Why an entry contributes nothing to the model's context.
 *
 * - `omitted`: a `context_edit` removed it from the context (the raw history keeps
 *   it, which is exactly why the viewer has to say so).
 * - `not-in-context`: it produces no message for another reason, such as sitting
 *   before a compaction boundary.
 */
export type ContextExclusionState = 'omitted' | 'not-in-context'

export interface ContextExclusion {
  state: ContextExclusionState
  /** The `context_edit` entry responsible, when the state is `omitted`. */
  editId?: string
}

/** The link between a `context_edit` entry and the entries it keeps out of context. */
export interface ContextEditLink {
  /** Entry this edit points at. */
  targetEntryId: string
  /** False when the target is not part of the shown branch. */
  targetOnBranch: boolean
  /** Entries (the target included) this edit removes from the model's context. */
  affectedEntryIds: string[]
}

/**
 * What the model actually received on one branch, as computed by Pi's own
 * `buildSessionProjection`. Absent (not empty) when Pi is unavailable, so the UI
 * can tell "nothing was excluded" apart from "we could not look".
 */
export interface ContextProjection {
  leafId: string | null
  /** Model-visible message count on this branch. */
  messageCount: number
  /** Number of projected entries on this branch. */
  contextEntryCount: number
  /** Context-producing entry ids that reach the model with no message. */
  excluded: Record<string, ContextExclusion>
  /** Pi version that produced the projection. */
  piVersion?: string
}

export interface TimelineEvent {
  id: string
  entryId: string
  kind: EventKind
  title: string
  summary: string
  content: string
  timestamp?: string
  durationMs?: number
  gapMs?: number
  toolCallId?: string
  toolName?: string
  toolDefinition?: CapturedToolDefinition
  isError?: boolean
  pairedEventId?: string
  targetEntryId?: string
  systemPrompt?: SystemPromptCapture
  toolDefinitions?: CapturedToolDefinition[]
  model?: { provider?: string; id?: string }
  subagent?: SubagentReference
  subagents?: SubagentReference[]
  /** Set when this entry is not part of the model's context on the shown branch. */
  contextExclusion?: ContextExclusion
  /** Set on `context_edit` entries: which entry they affect, and what else they removed. */
  contextEdit?: ContextEditLink
  raw: unknown
}

export interface TimelineTurn {
  id: string
  index: number
  label: string
  events: TimelineEvent[]
  startedAt?: string
  endedAt?: string
  /** Events in this turn that the model never saw. */
  contextExcludedCount?: number
}

export interface SessionStats {
  entryCount: number
  turnCount: number
  startedAt?: string
  endedAt?: string
  elapsedMs?: number
}

export interface ParsedSession {
  sourceName: string
  header: SessionHeader | null
  entries: ParsedEntry[]
  warnings: ParseWarning[]
  branches: BranchOption[]
  currentLeafId: string | null
  stats: SessionStats
}

export interface SessionView {
  branchEntries: ParsedEntry[]
  turns: TimelineTurn[]
  events: TimelineEvent[]
}

export interface SessionListItem {
  token: string
  id: string
  title: string
  cwd: string
  timestamp?: string
  modifiedAt: string
  relativePath: string
  parentSession?: string
}

export interface SessionListResponse {
  root: string
  currentCwd?: string
  sessions: SessionListItem[]
  warnings: string[]
}

export interface SessionFileResponse {
  token: string
  relativePath: string
  modifiedAt: string
  content: string
  /**
   * Per-branch context projections keyed by leaf id. Omitted when Pi's projection
   * API is unavailable to the server.
   */
  contextProjections?: Record<string, ContextProjection>
}
