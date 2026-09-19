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
  promptLength?: number
  composition?: SystemPromptComposition
  promptBeforeFinalExtensions?: string
  capturedAt?: string
  sequence?: number
  model?: { provider?: string; id?: string }
}

export interface SubagentReference {
  targetFile: string
  token: string
  agentName?: string
  task?: string
  sessionName?: string
  runId?: string
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
  raw: unknown
}

export interface TimelineTurn {
  id: string
  index: number
  label: string
  events: TimelineEvent[]
  startedAt?: string
  endedAt?: string
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
}
