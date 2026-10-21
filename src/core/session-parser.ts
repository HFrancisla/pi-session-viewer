import type {
  BranchOption,
  CapturedToolDefinition,
  ContextProjection,
  ParsedEntry,
  ParsedSession,
  ParseWarning,
  RawObject,
  SessionHeader,
  SessionView,
  SystemPromptComposition,
  TimelineEvent,
  TimelineTurn,
  ToolSourceInfo,
} from './types'
import { truncate } from './format'
import { sanitizeToolForApi } from './tool-provenance'
import { extractSubagentReferences } from './subagent-detector'

/**
 * Entry types this parser models. Asserted against Pi's own
 * `docs/session-format.md` by `tests/pi-entry-contract.test.ts`, so a new Pi
 * entry type cannot silently degrade into an "Unknown event" row.
 */
export const KNOWN_ENTRY_TYPES = new Set([
  'message',
  'model_change',
  'thinking_level_change',
  'compaction',
  'branch_summary',
  'context_edit',
  'usage',
  'custom',
  'custom_message',
  'label',
  'session_info',
])

function isObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function timestampValue(entry: ParsedEntry, message?: RawObject): string | undefined {
  if (entry.timestamp) return entry.timestamp
  const value = message?.timestamp
  if (typeof value === 'number') return new Date(value).toISOString()
  return stringValue(value)
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((block) => {
      if (!isObject(block)) return ''
      if (block.type === 'text') return stringValue(block.text) ?? ''
      if (block.type === 'thinking') return stringValue(block.thinking) ?? ''
      if (block.type === 'image') return `[Image ${stringValue(block.mimeType) ?? 'unknown format'}]`
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function durationValue(value: RawObject): number | undefined {
  return typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? value.durationMs : undefined
}

function getPath(entries: ParsedEntry[], leafId: string, warnings?: ParseWarning[]): ParsedEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const path: ParsedEntry[] = []
  const seen = new Set<string>()
  let cursor: ParsedEntry | undefined = byId.get(leafId)

  while (cursor) {
    if (seen.has(cursor.id)) {
      if (warnings && !warnings.some((warning) => warning.code === 'cycle' && warning.line === cursor?.line)) {
        warnings.push({ code: 'cycle', line: cursor.line, message: `Cycle detected at line ${cursor.line} on parentId; path stopped here.` })
      }
      break
    }
    seen.add(cursor.id)
    path.push(cursor)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }

  const orderedPath: ParsedEntry[] = []
  for (let index = path.length - 1; index >= 0; index -= 1) orderedPath.push(path[index])
  return orderedPath
}

function buildBranches(entries: ParsedEntry[], currentLeafId: string | null): BranchOption[] {
  if (!entries.length) return []
  const parentIds = new Set(entries.map((entry) => entry.parentId).filter((value): value is string => Boolean(value)))
  const leaves = entries.filter((entry) => !parentIds.has(entry.id))
  const labelByTarget = new Map<string, string>()

  for (const entry of entries) {
    if (entry.type === 'label') {
      const targetId = stringValue(entry.raw.targetId)
      const label = stringValue(entry.raw.label)
      if (targetId && label) labelByTarget.set(targetId, label)
    }
  }

  const ordered = leaves.sort((a, b) => {
    if (a.id === currentLeafId) return -1
    if (b.id === currentLeafId) return 1
    return (b.timestamp ?? '').localeCompare(a.timestamp ?? '')
  })

  return ordered.map((leaf, index) => {
    const path = getPath(entries, leaf.id)
    let named: string | undefined
    for (let pathIndex = path.length - 1; pathIndex >= 0 && !named; pathIndex -= 1) {
      named = labelByTarget.get(path[pathIndex].id)
    }
    const isCurrent = leaf.id === currentLeafId
    let label = named
    if (!label) label = isCurrent ? 'Current branch' : `Historical branch ${index + (currentLeafId ? 0 : 1)}`
    return {
      leafId: leaf.id,
      label,
      timestamp: leaf.timestamp,
      isCurrent,
    }
  })
}

export function parseSessionJsonl(content: string, sourceName = 'Local file'): ParsedSession {
  const warnings: ParseWarning[] = []
  const entries: ParsedEntry[] = []
  const seenIds = new Set<string>()
  let header: SessionHeader | null = null

  for (const [lineIndex, sourceLine] of content.split(/\r?\n/).entries()) {
    const line = sourceLine.trim()
    if (!line) continue
    const lineNumber = lineIndex + 1
    let raw: unknown

    try {
      raw = JSON.parse(line)
    } catch {
      warnings.push({ code: 'invalid-json', line: lineNumber, message: `Line ${lineNumber} is not valid JSON; skipped.` })
      continue
    }

    if (!isObject(raw)) {
      warnings.push({ code: 'invalid-entry', line: lineNumber, message: `Line ${lineNumber} is not a JSON object; skipped.` })
      continue
    }

    if (!header && raw.type === 'session') {
      header = raw as SessionHeader
      continue
    }

    const id = stringValue(raw.id)
    const type = stringValue(raw.type)
    if (!id || !type) {
      warnings.push({ code: 'invalid-entry', line: lineNumber, message: `Line ${lineNumber} is missing id or type; skipped.` })
      continue
    }
    if (seenIds.has(id)) {
      warnings.push({ code: 'duplicate-id', line: lineNumber, message: `Duplicate id "${id}" at line ${lineNumber}; skipped.` })
      continue
    }
    seenIds.add(id)
    if (!KNOWN_ENTRY_TYPES.has(type)) {
      warnings.push({ code: 'unknown-type', line: lineNumber, message: `Unknown event type "${type}" at line ${lineNumber}; preserved.` })
    }

    entries.push({
      id,
      parentId: raw.parentId === null ? null : stringValue(raw.parentId) ?? null,
      type,
      timestamp: stringValue(raw.timestamp),
      line: lineNumber,
      raw,
    })
  }

  if (!header) {
    warnings.unshift({ code: 'invalid-header', message: 'Missing session header entry; parsed remaining entries.' })
  }

  const ids = new Set(entries.map((entry) => entry.id))
  for (const entry of entries) {
    if (entry.parentId && !ids.has(entry.parentId)) {
      warnings.push({
        code: 'missing-parent',
        line: entry.line,
        message: `Line ${entry.line} references non-existent parentId "${entry.parentId}".`,
      })
    }
  }

  const currentLeafId = entries.at(-1)?.id ?? null
  if (currentLeafId) getPath(entries, currentLeafId, warnings)
  const branches = buildBranches(entries, currentLeafId)
  const parsed: ParsedSession = {
    sourceName,
    header,
    entries,
    warnings,
    branches,
    currentLeafId,
    stats: { entryCount: entries.length, turnCount: 0 },
  }
  const currentView = buildSessionView(parsed, currentLeafId)
  const timestamps = currentView.events
    .map((event) => event.timestamp ? new Date(event.timestamp).getTime() : Number.NaN)
    .filter(Number.isFinite)
  const startedAt = header?.timestamp ?? currentView.events.find((event) => event.timestamp)?.timestamp
  let endedAt: string | undefined
  for (let index = currentView.events.length - 1; index >= 0 && !endedAt; index -= 1) {
    endedAt = currentView.events[index].timestamp
  }
  const startMs = startedAt ? new Date(startedAt).getTime() : timestamps[0]
  const endMs = endedAt ? new Date(endedAt).getTime() : timestamps.at(-1)
  const elapsedMs = typeof startMs === 'number' && Number.isFinite(startMs)
    && typeof endMs === 'number' && Number.isFinite(endMs)
    ? Math.max(0, endMs - startMs)
    : undefined

  parsed.stats = {
    entryCount: entries.length,
    turnCount: currentView.turns.filter((turn) => turn.index > 0).length,
    startedAt,
    endedAt,
    elapsedMs,
  }
  return parsed
}

function piSystemContextEvent(
  entry: ParsedEntry,
  message: RawObject,
  timestamp: string | undefined,
  isInitialSystemMessage: boolean,
): TimelineEvent {
  const sections = isObject(message.sections) ? Object.entries(message.sections) : []
  const toolsAdded = Array.isArray(message.toolsAdded) ? message.toolsAdded.filter(isObject) : []
  const toolsRemoved = Array.isArray(message.toolsRemoved) ? message.toolsRemoved : []
  const hasFullSnapshot = isInitialSystemMessage
    && (typeof message.content === 'string' && message.content.length > 0
      || sections.some(([name, value]) => name === 'preamble' && typeof value === 'string'))
  const contentParts: string[] = []

  if (sections.length > 0) {
    contentParts.push(hasFullSnapshot ? 'Prompt sections in this Pi system snapshot:' : 'Prompt section changes:')
    for (const [name, value] of sections) {
      if (value === null) {
        contentParts.push(`Removed section <${name}>`)
      } else {
        const sectionContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        contentParts.push(`Section <${name}>:\n${sectionContent}`)
      }
    }
  }

  if (toolsAdded.length > 0) {
    contentParts.push('Tools added:', ...toolsAdded.map((tool) => JSON.stringify(tool, null, 2)))
  }
  if (toolsRemoved.length > 0) {
    contentParts.push('Tools removed:', ...toolsRemoved.map((tool) => (
      isObject(tool) ? stringValue(tool.name) ?? JSON.stringify(tool) : stringValue(tool) ?? JSON.stringify(tool)
    )))
  }

  const summaryParts: string[] = []
  if (sections.length > 0) {
    const removedSections = sections.filter(([, value]) => value === null).length
    summaryParts.push(hasFullSnapshot
      ? `${sections.length} prompt sections`
      : `${sections.length} prompt section changes (${removedSections} removed)`)
  }
  if (toolsAdded.length > 0 || toolsRemoved.length > 0) {
    summaryParts.push(`Tools: +${toolsAdded.length} / -${toolsRemoved.length}`)
  }
  const content = contentParts.length > 0 ? contentParts.join('\n\n') : contentText(message.content)

  return {
    id: `${entry.id}:system-context`, entryId: entry.id, kind: 'system',
    title: hasFullSnapshot ? 'Pi system context snapshot' : 'Pi system context update',
    summary: summaryParts.join(' · ') || truncate(content),
    content, timestamp, raw: entry.raw,
  }
}

function messageEvents(entry: ParsedEntry, sourceName?: string, isInitialSystemMessage = false): TimelineEvent[] {
  const message = isObject(entry.raw.message) ? entry.raw.message : {}
  const role = stringValue(message.role) ?? 'unknown'
  const timestamp = timestampValue(entry, message)

  if (role === 'user') {
    const content = contentText(message.content)
    return [{
      id: `${entry.id}:user`, entryId: entry.id, kind: 'user', title: 'User', summary: truncate(content),
      content, timestamp, durationMs: durationValue(message), raw: entry.raw,
    }]
  }

  if (role === 'toolResult') {
    const content = contentText(message.content)
    const toolName = stringValue(message.toolName) ?? 'Unknown tool'
    const isError = message.isError === true
    const subagents = extractSubagentReferences(toolName, undefined, content, message.details, sourceName)
    const subagent = subagents[0]
    return [{
      id: `${entry.id}:result`, entryId: entry.id, kind: 'tool-result',
      title: `${toolName} ${isError ? 'failed' : 'result'}`, summary: truncate(content), content,
      timestamp, durationMs: durationValue(message), toolCallId: stringValue(message.toolCallId), toolName,
      isError, subagent, subagents: subagents.length > 1 ? subagents : undefined, raw: entry.raw,
    }]
  }

  if (role === 'system') {
    const hasSystemContextPatch = (isObject(message.sections) && Object.keys(message.sections).length > 0)
      || (Array.isArray(message.toolsAdded) && message.toolsAdded.length > 0)
      || (Array.isArray(message.toolsRemoved) && message.toolsRemoved.length > 0)
      || (typeof message.content === 'string' && message.content.length > 0)
    if (hasSystemContextPatch) {
      return [piSystemContextEvent(entry, message, timestamp, isInitialSystemMessage)]
    }
  }

  if (role !== 'assistant') {
    const content = contentText(message.content)
    return [{
      id: `${entry.id}:message`, entryId: entry.id, kind: 'system', title: `Message: ${role}`,
      summary: truncate(content), content, timestamp, raw: entry.raw,
    }]
  }

  const modelValue = isObject(message.model) ? message.model : undefined
  const provider = stringValue(message.provider) ?? stringValue(modelValue?.provider)
  const modelId = stringValue(message.model) ?? stringValue(message.modelId) ?? stringValue(modelValue?.id)
  const model = provider || modelId ? { provider, id: modelId } : undefined

  const blocks = Array.isArray(message.content) ? message.content : []
  const events: TimelineEvent[] = []
  let textBuffer: string[] = []
  let textStartIndex = 0

  const flushText = () => {
    if (!textBuffer.length) return
    const content = textBuffer.join('\n\n')
    events.push({
      id: `${entry.id}:assistant:${textStartIndex}`, entryId: entry.id, kind: 'assistant', title: 'Pi Response',
      summary: truncate(content), content, timestamp, durationMs: durationValue(message), model, raw: entry.raw,
    })
    textBuffer = []
  }

  blocks.forEach((block, index) => {
    if (!isObject(block)) return
    if (block.type === 'text') {
      if (!textBuffer.length) textStartIndex = index
      textBuffer.push(stringValue(block.text) ?? '')
      return
    }
    flushText()
    if (block.type === 'thinking') {
      const content = stringValue(block.thinking) ?? ''
      events.push({
        id: `${entry.id}:thinking:${index}`, entryId: entry.id, kind: 'thinking', title: 'Thinking',
        summary: truncate(content), content, timestamp, model, raw: entry.raw,
      })
    } else if (block.type === 'toolCall') {
      const toolName = stringValue(block.name) ?? 'Unknown tool'
      const toolCallId = stringValue(block.id)
      const content = JSON.stringify(block.arguments ?? {}, null, 2)
      events.push({
        id: `${entry.id}:tool:${index}`, entryId: entry.id, kind: 'tool-call', title: `Call ${toolName}`,
        summary: truncate(content), content, timestamp, durationMs: durationValue(block), toolCallId, toolName,
        model, raw: entry.raw,
      })
    } else if (block.type === 'image') {
      events.push({
        id: `${entry.id}:image:${index}`, entryId: entry.id, kind: 'assistant', title: 'Pi Response',
        summary: `[Image ${stringValue(block.mimeType) ?? 'unknown format'}]`, content: '[Image rendering omitted]',
        timestamp, model, raw: entry.raw,
      })
    }
  })
  flushText()

  if (!events.length) {
    events.push({
      id: `${entry.id}:assistant`, entryId: entry.id, kind: 'assistant', title: 'Pi Response', summary: 'No text content',
      content: '', timestamp, durationMs: durationValue(message), model, raw: entry.raw,
    })
  }
  return events
}

const SYSTEM_PROMPT_CUSTOM_TYPE = 'pi-session-viewer.system-prompt'

type PromptSnapshotData = RawObject

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isObject(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((item): item is [string, string] => typeof item[1] === 'string'))
}

function promptComposition(value: unknown): SystemPromptComposition | undefined {
  if (!isObject(value)) return undefined
  const contextFiles = Array.isArray(value.contextFiles)
    ? value.contextFiles.filter(isObject).map((file) => ({
        path: stringValue(file.path) ?? 'Unknown path',
        content: stringValue(file.content) ?? '',
      }))
    : []
  const skills = Array.isArray(value.skills)
    ? value.skills.filter(isObject).map((skill) => ({
        name: stringValue(skill.name) ?? 'Unnamed skill',
        description: stringValue(skill.description) ?? '',
        filePath: stringValue(skill.filePath) ?? '',
        baseDir: stringValue(skill.baseDir),
        disableModelInvocation: skill.disableModelInvocation === true,
      }))
    : []
  const toolDefinitions: CapturedToolDefinition[] = Array.isArray(value.toolDefinitions)
    ? value.toolDefinitions.filter(isObject).map((tool) => ({
        ...tool,
        name: stringValue(tool.name) ?? 'Unnamed tool',
        description: stringValue(tool.description),
        parameters: tool.parameters,
        promptGuidelines: stringArray(tool.promptGuidelines),
        sourceInfo: isObject(tool.sourceInfo) ? (tool.sourceInfo as ToolSourceInfo) : undefined,
      }))
    : []
  return {
    customPrompt: stringValue(value.customPrompt),
    selectedTools: stringArray(value.selectedTools),
    toolSnippets: stringRecord(value.toolSnippets),
    toolDefinitions: toolDefinitions.length > 0 ? toolDefinitions : undefined,
    promptGuidelines: stringArray(value.promptGuidelines),
    appendSystemPrompt: stringValue(value.appendSystemPrompt),
    cwd: stringValue(value.cwd) ?? '',
    contextFiles,
    skills,
  }
}

function collectPromptSnapshots(entries: ParsedEntry[]): Map<string, PromptSnapshotData> {
  const snapshots = new Map<string, PromptSnapshotData>()
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.raw.customType !== SYSTEM_PROMPT_CUSTOM_TYPE || !isObject(entry.raw.data)) continue
    const hash = stringValue(entry.raw.data.promptHash)
    if (hash && typeof entry.raw.data.prompt === 'string') snapshots.set(hash, entry.raw.data)
  }
  return snapshots
}

function capturedSystemPromptEvent(entry: ParsedEntry, snapshots: Map<string, PromptSnapshotData>): TimelineEvent | undefined {
  if (entry.type !== 'custom' || entry.raw.customType !== SYSTEM_PROMPT_CUSTOM_TYPE || !isObject(entry.raw.data)) return undefined
  const data = entry.raw.data
  const hash = stringValue(data.promptHash)
  const snapshot = typeof data.prompt === 'string' ? data : hash ? snapshots.get(hash) : undefined
  const prompt = typeof snapshot?.prompt === 'string' ? snapshot.prompt : undefined
  const composition = promptComposition(snapshot?.composition)
  const promptLength = typeof data.promptLength === 'number' ? data.promptLength : prompt?.length
  const modelValue = isObject(data.model) ? data.model : undefined
  const recordType = data.recordType === 'reference' ? 'reference' : 'snapshot'
  const captureStage = data.captureStage === 'provider_request_update' ? 'provider_request_update' : 'agent_start'
  const summaryParts: string[] = []
  if (composition?.skills.length) summaryParts.push(`Mounted ${composition.skills.length} ${composition.skills.length === 1 ? 'skill' : 'skills'}`)
  if (composition?.contextFiles.length) summaryParts.push(`${composition.contextFiles.length} context ${composition.contextFiles.length === 1 ? 'file' : 'files'}`)
  const defaultSummary = recordType === 'snapshot' ? 'Full snapshot' : recordType === 'reference' ? 'Snapshot reference' : 'System prompt'
  const title = prompt === undefined
    ? 'System prompt missing'
    : prompt.length === 0
      ? 'System prompt empty'
      : captureStage === 'provider_request_update' ? 'System prompt update' : 'System prompt'
  const summary = prompt === undefined
    ? `Unable to resolve prompt snapshot for hash ${hash ?? 'unknown'}`
    : prompt.length === 0
      ? 'Captured empty effective system prompt'
      : summaryParts.length ? summaryParts.join(' · ') : defaultSummary

  return {
    id: `${entry.id}:system-prompt`,
    entryId: entry.id,
    kind: 'system-prompt',
    title,
    summary,
    content: prompt ?? 'The complete system prompt snapshot for this reference is not in the current session file.',
    timestamp: entry.timestamp,
    targetEntryId: stringValue(data.targetUserEntryId),
    systemPrompt: {
      promptHash: hash,
      recordType,
      captureStage,
      messageType: data.messageType === 'user' || data.messageType === 'custom' ? data.messageType : undefined,
      promptLength,
      composition,
      promptBeforeFinalExtensions: stringValue(snapshot?.promptBeforeFinalExtensions),
      capturedAt: stringValue(data.capturedAt),
      sequence: typeof data.sequence === 'number' ? data.sequence : undefined,
      model: modelValue ? { provider: stringValue(modelValue.provider), id: stringValue(modelValue.id) } : undefined,
    },
    model: modelValue ? { provider: stringValue(modelValue.provider), id: stringValue(modelValue.id) } : undefined,
    raw: entry.raw,
  }
}

function buildToolDefinitionsEvent(promptEvent: TimelineEvent): TimelineEvent | undefined {
  const composition = promptEvent.systemPrompt?.composition
  if (!composition?.toolDefinitions?.length) return undefined

  const tools = composition.toolDefinitions
  const apiTools = tools.map(sanitizeToolForApi)
  const jsonContent = JSON.stringify(apiTools, null, 2)
  const charCount = jsonContent.length
  const estimatedTokens = Math.ceil(charCount / 4)

  return {
    id: `${promptEvent.entryId}:tool-definitions`,
    entryId: promptEvent.entryId,
    kind: 'tool-definitions',
    title: 'Tool Definitions',
    summary: `Mounted ${tools.length} API tools`,
    content: jsonContent,
    timestamp: promptEvent.timestamp,
    targetEntryId: promptEvent.targetEntryId,
    systemPrompt: promptEvent.systemPrompt,
    toolDefinitions: tools,
    raw: {
      type: 'tool-definitions',
      tools: apiTools,
      charCount,
      estimatedTokens,
    },
  }
}

/**
 * Pi's `context_edit` entry is an append-only edit of one earlier entry's
 * contribution to model context: `replacement: null` drops the target from the
 * context, a non-null replacement replaces its content.
 */
function contextEditContent(raw: RawObject): string {
  const targetId = stringValue(raw.targetId) ?? 'unknown target'
  if (raw.replacement === null || raw.replacement === undefined) {
    return `Target: ${targetId}\nEffect: omitted from model context`
  }
  const replacement = typeof raw.replacement === 'string'
    ? raw.replacement
    : contentText(raw.replacement) || JSON.stringify(raw.replacement, null, 2)
  return `Target: ${targetId}\nEffect: model context replaced with:\n\n${replacement}`
}

/** Pi's `usage` entry records usage that is not attached to an assistant message. */
function usageContent(raw: RawObject): string {
  const lines: string[] = []
  const model = [stringValue(raw.provider), stringValue(raw.model)].filter(Boolean).join(' / ')
  if (model) lines.push(`Model: ${model}`)

  const usage = isObject(raw.usage) ? raw.usage : undefined
  if (usage) {
    const tokens = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']
      .map((key) => (typeof usage[key] === 'number' ? `${key}=${usage[key]}` : undefined))
      .filter((value): value is string => Boolean(value))
    if (tokens.length > 0) lines.push(`Tokens: ${tokens.join(', ')}`)
    if (isObject(usage.cost)) lines.push(`Cost: ${JSON.stringify(usage.cost)}`)
  }

  return lines.length > 0 ? lines.join('\n') : JSON.stringify(raw, null, 2)
}

function systemEvents(entry: ParsedEntry, snapshots: Map<string, PromptSnapshotData>): TimelineEvent[] {
  const capturedPrompt = capturedSystemPromptEvent(entry, snapshots)
  if (capturedPrompt) {
    const list = [capturedPrompt]
    const toolEvent = buildToolDefinitionsEvent(capturedPrompt)
    if (toolEvent) list.push(toolEvent)
    return list
  }

  const raw = entry.raw
  const usageKind = entry.type === 'usage' ? stringValue(raw.kind) : undefined
  const labels: Record<string, string> = {
    model_change: 'Model Switch',
    thinking_level_change: 'Thinking Level Switch',
    compaction: 'Context Compaction',
    branch_summary: 'Branch Summary',
    context_edit: 'Context Edit',
    usage: usageKind ? `Usage: ${usageKind}` : 'Usage',
    custom: `Custom event: ${stringValue(raw.customType) ?? 'unnamed'}`,
    custom_message: `Custom message: ${stringValue(raw.customType) ?? 'unnamed'}`,
    label: 'Branch label',
    session_info: 'Session info',
  }
  let content = ''
  let model: { provider?: string; id?: string } | undefined
  if (entry.type === 'model_change') {
    content = `${stringValue(raw.provider) ?? 'Unknown provider'} / ${stringValue(raw.modelId) ?? 'Unknown model'}`
    model = { provider: stringValue(raw.provider), id: stringValue(raw.modelId) }
  }
  else if (entry.type === 'thinking_level_change') content = stringValue(raw.thinkingLevel) ?? ''
  else if (entry.type === 'compaction' || entry.type === 'branch_summary') content = stringValue(raw.summary) ?? ''
  else if (entry.type === 'custom_message') content = contentText(raw.content)
  else if (entry.type === 'session_info') content = stringValue(raw.name) ?? ''
  else if (entry.type === 'label') content = stringValue(raw.label) ?? ''
  else if (entry.type === 'context_edit') content = contextEditContent(raw)
  else if (entry.type === 'usage') {
    content = usageContent(raw)
    model = { provider: stringValue(raw.provider), id: stringValue(raw.model) }
  }
  else content = JSON.stringify(raw.data ?? raw, null, 2)

  return [{
    id: `${entry.id}:system`, entryId: entry.id, kind: 'system', title: labels[entry.type] ?? `Unknown event: ${entry.type}`,
    summary: truncate(content), content, timestamp: entry.timestamp, durationMs: durationValue(raw), model, raw,
  }]
}

function pairTools(events: TimelineEvent[], sourceName?: string): void {
  const calls = new Map<string, TimelineEvent>()
  const toolDefs = new Map<string, CapturedToolDefinition>()
  let previousTimestamp: number | undefined

  for (const event of events) {
    if (event.toolDefinitions) {
      for (const td of event.toolDefinitions) {
        toolDefs.set(td.name, td)
      }
    }
    if (event.systemPrompt?.composition?.toolDefinitions) {
      for (const td of event.systemPrompt.composition.toolDefinitions) {
        toolDefs.set(td.name, td)
      }
    }
  }

  for (const event of events) {
    if (event.timestamp) {
      const time = new Date(event.timestamp).getTime()
      if (Number.isFinite(time)) {
        if (previousTimestamp != null) event.gapMs = Math.max(0, time - previousTimestamp)
        previousTimestamp = time
      }
    }
    if (event.kind === 'tool-call') {
      if (event.toolName && toolDefs.has(event.toolName)) {
        event.toolDefinition = toolDefs.get(event.toolName)
      }
      if (event.toolCallId) calls.set(event.toolCallId, event)
    }
    if (event.kind === 'tool-result' && event.toolCallId) {
      const call = calls.get(event.toolCallId)
      if (call) {
        call.pairedEventId = event.id
        event.pairedEventId = call.id
        if (call.toolDefinition && !event.toolDefinition) {
          event.toolDefinition = call.toolDefinition
        }
        const eventMessage = isObject(event.raw) && isObject((event.raw as RawObject).message)
          ? (event.raw as RawObject).message as RawObject
          : undefined
        const subagents = extractSubagentReferences(
          call.toolName ?? event.toolName ?? '',
          call.content,
          event.content,
          eventMessage?.details,
          sourceName,
        )
        const effectiveSubagents = subagents.length > 0
          ? subagents
          : (event.subagents ?? (event.subagent ? [event.subagent] : undefined) ?? call.subagents ?? (call.subagent ? [call.subagent] : undefined))
        const effectiveSubagent = effectiveSubagents?.[0] ?? event.subagent ?? call.subagent
        if (effectiveSubagent) {
          event.subagent = effectiveSubagent
          if (effectiveSubagents && effectiveSubagents.length > 1) {
            event.subagents = effectiveSubagents
          }
        }
      }
    }
  }
}

function attachSubagentReference(event: TimelineEvent, reference: NonNullable<TimelineEvent['subagent']>): void {
  const references = event.subagents ?? (event.subagent ? [event.subagent] : [])
  if (references.some((existing) => existing.targetFile === reference.targetFile
    || (existing.runId && existing.runId === reference.runId))) return

  const combined = [...references, reference]
  event.subagent = combined[0]
  if (combined.length > 1) event.subagents = combined
}

/**
 * Link pi-subagents' asynchronous completion notices to the tool result that
 * launched the run. The notice is a separate custom_message entry, not a
 * toolResult, so pairTools cannot see its sessionValue while pairing calls.
 */
function linkAsyncSubagentNotifications(events: TimelineEvent[], sourceName?: string): void {
  const resultsByRunId = new Map<string, TimelineEvent[]>()

  for (const event of events) {
    if (event.kind !== 'tool-result' || event.toolName !== 'subagent' || !isObject(event.raw)) continue
    const message = isObject(event.raw.message) ? event.raw.message : undefined
    const details = message && isObject(message.details) ? message.details : undefined
    const runId = stringValue(details?.runId)
    if (!runId) continue
    const results = resultsByRunId.get(runId) ?? []
    results.push(event)
    resultsByRunId.set(runId, results)
  }

  for (const event of events) {
    if (event.kind !== 'system' || !isObject(event.raw)
      || event.raw.type !== 'custom_message' || event.raw.customType !== 'subagent-notify') continue
    const details = isObject(event.raw.details) ? event.raw.details : undefined
    if (!Array.isArray(details?.runs)) continue

    for (const run of details.runs) {
      if (!isObject(run)) continue
      const runId = stringValue(run.runId)
      const sessionValue = stringValue(run.sessionValue)
      if (!runId || !sessionValue?.toLowerCase().endsWith('.jsonl')) continue

      const matches = resultsByRunId.get(runId)
      if (matches?.length !== 1) continue
      const result = matches[0]
      const resultMessage = isObject(result.raw) && isObject(result.raw.message) ? result.raw.message : undefined
      const resultDetails = resultMessage && isObject(resultMessage.details) ? resultMessage.details : undefined
      const detailToolCallId = stringValue(resultDetails?.toolCallId)
      if (detailToolCallId && detailToolCallId !== result.toolCallId) continue

      const reference = extractSubagentReferences('subagent', {
        sessionFile: sessionValue,
        agent: run.agent,
        task: run.task,
        sessionName: run.sessionLabel,
        runId,
      }, undefined, undefined, sourceName)[0]
      if (reference) attachSubagentReference(result, reference)
    }
  }
}

function missingSystemPromptEvent(user: TimelineEvent): TimelineEvent {
  return {
    id: `missing-system-prompt:${user.entryId}`,
    entryId: `missing-system-prompt:${user.entryId}`,
    kind: 'system-prompt',
    title: 'System prompt unrecorded',
    summary: 'No system-prompt capture record is associated with this turn; the reason is unknown.',
    content: 'This Pi session contains no captured system prompt associated with this turn. This does not establish whether the run had no system prompt or why capture is absent. Historical prompts are never reconstructed from current configuration.',
    timestamp: user.timestamp,
    targetEntryId: user.entryId,
    systemPrompt: { recordType: 'missing' },
    raw: { type: 'synthetic', reason: 'system-prompt-not-captured', targetUserEntryId: user.entryId },
  }
}

function placeSystemPromptsBeforeUsers(events: TimelineEvent[]): TimelineEvent[] {
  const hasNativeSystemPromptSnapshot = events.some(
    (event) => event.kind === 'system' && event.title === 'Pi system context snapshot'
  )
  const promptsByUser = new Map<string, TimelineEvent[]>()
  for (const event of events) {
    if ((event.kind !== 'system-prompt' && event.kind !== 'tool-definitions') || !event.targetEntryId) continue
    const prompts = promptsByUser.get(event.targetEntryId) ?? []
    prompts.push(event)
    promptsByUser.set(event.targetEntryId, prompts)
  }

  const placed = new Set<string>()
  const ordered: TimelineEvent[] = []
  let activePromptHash: string | undefined
  let isFirstUser = true

  for (const event of events) {
    if (event.kind === 'system-prompt' || event.kind === 'tool-definitions') {
      if (event.targetEntryId) continue
      // Mid-turn prompt update (no targetEntryId): keep it inline and track hash
      if (event.systemPrompt?.promptHash) {
        activePromptHash = event.systemPrompt.promptHash
      }
      ordered.push(event)
      continue
    }

    if (event.kind === 'user') {
      const candidatePrompts = promptsByUser.get(event.entryId)

      if (isFirstUser) {
        isFirstUser = false
        const prompts = candidatePrompts ?? (hasNativeSystemPromptSnapshot ? [] : [missingSystemPromptEvent(event)])
        prompts.forEach((prompt, index) => {
          prompt.timestamp = event.timestamp
          prompt.gapMs = index === 0 ? event.gapMs : 0
          if (prompt.systemPrompt?.promptHash) {
            activePromptHash = prompt.systemPrompt.promptHash
          }
          placed.add(prompt.id)
          ordered.push(prompt)
        })
        event.gapMs = 0
      } else {
        // Subsequent turns: only place system prompts if the prompt has changed!
        if (candidatePrompts && candidatePrompts.length > 0) {
          const changedPrompts = candidatePrompts.filter((prompt) => {
            const hash = prompt.systemPrompt?.promptHash
            return !hash || hash !== activePromptHash
          })

          if (changedPrompts.length > 0) {
            changedPrompts.forEach((prompt, index) => {
              prompt.timestamp = event.timestamp
              prompt.gapMs = index === 0 ? event.gapMs : 0
              if (prompt.title === 'System prompt') {
                prompt.title = 'System prompt update'
              }
              if (prompt.systemPrompt?.promptHash) {
                activePromptHash = prompt.systemPrompt.promptHash
              }
              placed.add(prompt.id)
              ordered.push(prompt)
            })
            event.gapMs = 0
          }
          candidatePrompts.forEach((prompt) => placed.add(prompt.id))
        }
      }
    }
    ordered.push(event)
  }

  for (const event of events) {
    if ((event.kind === 'system-prompt' || event.kind === 'tool-definitions') && event.targetEntryId && !placed.has(event.id)) ordered.push(event)
  }
  return ordered
}

function groupTurns(events: TimelineEvent[]): TimelineTurn[] {
  const turns: TimelineTurn[] = []
  const promptPrelude: TimelineEvent[] = []
  let current: TimelineTurn | undefined
  let turnIndex = 0
  let groupIndex = 0
  let customRunIndex = 0

  for (const event of events) {
    if ((event.kind === 'system-prompt' || event.kind === 'tool-definitions') && event.targetEntryId) {
      promptPrelude.push(event)
      continue
    }
    if (
      event.kind === 'system-prompt'
      && event.systemPrompt?.messageType === 'custom'
      && (event.systemPrompt.captureStage ?? 'agent_start') === 'agent_start'
    ) {
      customRunIndex += 1
      groupIndex += 1
      current = {
        id: `custom-run-${customRunIndex}`,
        index: groupIndex,
        label: 'Custom run',
        events: promptPrelude.splice(0),
        startedAt: event.timestamp,
      }
      turns.push(current)
      current.events.push(event)
      current.endedAt = event.timestamp
      continue
    }
    if (event.kind === 'user') {
      turnIndex += 1
      groupIndex += 1
      current = { id: `turn-${turnIndex}`, index: groupIndex, label: `Turn ${turnIndex}`, events: [], startedAt: event.timestamp }
      current.events.push(...promptPrelude.splice(0))
      turns.push(current)
    } else if (!current) {
      current = { id: 'turn-setup', index: 0, label: 'Session setup', events: [] }
      turns.push(current)
    }
    current.events.push(event)
    current.endedAt = event.timestamp ?? current.endedAt
  }

  if (promptPrelude.length > 0) {
    if (!current) {
      current = { id: 'turn-setup', index: 0, label: 'Session setup', events: [] }
      turns.push(current)
    }
    current.events.push(...promptPrelude)
  }
  return turns
}

function inferMissingPromptTargets(events: TimelineEvent[]): void {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if ((event.kind !== 'system-prompt' && event.kind !== 'tool-definitions') || event.targetEntryId) continue
    if (event.systemPrompt?.messageType === 'custom') continue

    const captureStage = event.systemPrompt?.captureStage ?? 'agent_start'
    if (captureStage !== 'agent_start') continue

    // 1. Look forward for the next user event (e.g. legacy snapshots recorded at agent_start before user persisted)
    for (let nextIndex = index + 1; nextIndex < events.length; nextIndex += 1) {
      const candidate = events[nextIndex]
      if (candidate.kind === 'user') {
        event.targetEntryId = candidate.entryId
        break
      }
      if (candidate.kind === 'assistant' || candidate.kind === 'tool-call' || candidate.kind === 'tool-result') {
        break
      }
    }

    // 2. If not found, look backward to check if it immediately followed a user event
    if (!event.targetEntryId) {
      for (let prevIndex = index - 1; prevIndex >= 0; prevIndex -= 1) {
        const candidate = events[prevIndex]
        if (candidate.kind === 'user') {
          event.targetEntryId = candidate.entryId
          break
        }
        if (candidate.kind === 'assistant' || candidate.kind === 'tool-call' || candidate.kind === 'tool-result') {
          break
        }
      }
    }
  }
}

/** The entry a `context_edit` points at, read from the raw record. */
function contextEditTargetId(event: TimelineEvent): string | undefined {
  if (event.kind !== 'system' || !isObject(event.raw)) return undefined
  if (stringValue(event.raw.type) !== 'context_edit') return undefined
  return stringValue(event.raw.targetId)
}

/** Picks the event that best represents an entry when jumping to it. */
const JUMP_KIND_PRIORITY: Record<string, number> = {
  assistant: 5,
  user: 4,
  'tool-result': 3,
  system: 2,
  'system-prompt': 1,
  'tool-definitions': 1,
  thinking: 0,
  'tool-call': 0,
}

export function primaryEventForEntry(events: TimelineEvent[]): TimelineEvent | undefined {
  let best: TimelineEvent | undefined
  let bestScore = -1
  for (const event of events) {
    const score = JUMP_KIND_PRIORITY[event.kind] ?? 1
    if (score > bestScore) {
      best = event
      bestScore = score
    }
  }
  return best
}

/**
 * Applies the model-context projection to the timeline.
 *
 * The projection is computed by Pi itself (see `server/context-projection.ts`);
 * without it nothing is marked, because "this message was not in the context" is
 * not something the raw transcript can tell on its own. Besides marking the
 * excluded rows, this connects the two ends of the story: each `context_edit`
 * event learns which entry it affects and what else it removed, so the UI can
 * offer a jump in both directions.
 */
function applyContextProjection(events: TimelineEvent[], projection?: ContextProjection): void {
  if (!projection) return

  const eventsByEntry = new Map<string, TimelineEvent[]>()
  for (const event of events) {
    const list = eventsByEntry.get(event.entryId)
    if (list) list.push(event)
    else eventsByEntry.set(event.entryId, [event])
  }

  for (const event of events) {
    const exclusion = projection.excluded[event.entryId]
    if (exclusion) event.contextExclusion = exclusion
  }

  // Which entries each edit keeps out of context (an edit can affect more than its
  // target: Pi omits the tool results of a discarded attempt too).
  const affectedByEdit = new Map<string, string[]>()
  for (const [entryId, exclusion] of Object.entries(projection.excluded)) {
    if (!exclusion.editId) continue
    const list = affectedByEdit.get(exclusion.editId)
    if (list) list.push(entryId)
    else affectedByEdit.set(exclusion.editId, [entryId])
  }

  for (const event of events) {
    const targetEntryId = contextEditTargetId(event)
    if (!targetEntryId) continue
    const targetEvents = eventsByEntry.get(targetEntryId)
    const target = targetEvents ? primaryEventForEntry(targetEvents) : undefined
    const affectedEntryIds = (affectedByEdit.get(event.entryId) ?? []).sort()

    event.contextEdit = {
      targetEntryId,
      targetOnBranch: Boolean(targetEvents),
      affectedEntryIds,
    }

    // The raw content stays factual; the preview makes the target identifiable
    // without cross-referencing ids by hand.
    const lines = [`Target: ${targetEntryId}`]
    if (target) {
      const label = target.kind === 'system' ? target.title : `${target.title}`
      lines.push(`  ${label} — ${target.summary}`)
    } else {
      lines.push('  (not on this branch)')
    }
    const replacement = isObject(event.raw) ? event.raw.replacement : undefined
    lines.push(
      replacement === null || replacement === undefined
        ? 'Effect: omitted from model context'
        : 'Effect: model context replaced with:'
    )
    if (replacement !== null && replacement !== undefined) {
      lines.push('', typeof replacement === 'string' ? replacement : JSON.stringify(replacement, null, 2))
    }
    lines.push(
      affectedEntryIds.length > 0
        ? `Also removed from model context: ${affectedEntryIds.join(', ')}`
        : 'Also removed from model context: none'
    )

    event.content = lines.join('\n')
    event.summary = truncate(`Target: ${target ? target.summary : targetEntryId}`)
  }
}

export function buildSessionView(
  session: ParsedSession,
  requestedLeafId?: string | null,
  contextProjection?: ContextProjection
): SessionView {
  const leafId = requestedLeafId && session.entries.some((entry) => entry.id === requestedLeafId)
    ? requestedLeafId
    : session.currentLeafId
  const branchEntries = leafId ? getPath(session.entries, leafId) : []
  const snapshots = collectPromptSnapshots(session.entries)
  const firstSystemMessageId = branchEntries.find((entry) => (
    entry.type === 'message'
    && isObject(entry.raw.message)
    && entry.raw.message.role === 'system'
  ))?.id
  const rawEvents = branchEntries.flatMap((entry) => entry.type === 'message'
    ? messageEvents(entry, session.sourceName, entry.id === firstSystemMessageId)
    : systemEvents(entry, snapshots))
  pairTools(rawEvents, session.sourceName)
  linkAsyncSubagentNotifications(rawEvents, session.sourceName)
  inferMissingPromptTargets(rawEvents)
  const events = placeSystemPromptsBeforeUsers(rawEvents)
  applyContextProjection(events, contextProjection)
  const turns = groupTurns(events)
  for (const turn of turns) {
    // Count entries, not rows: one omitted entry can expand into several events
    // (thinking, text, tool calls), and the branch summary reports entries too.
    const excluded = new Set(
      turn.events.filter((event) => event.contextExclusion).map((event) => event.entryId)
    ).size
    if (excluded > 0) turn.contextExcludedCount = excluded
  }
  return { branchEntries, events, turns }
}

export function getSessionTitle(session: ParsedSession): string {
  let name: string | undefined
  for (let index = session.entries.length - 1; index >= 0 && !name; index -= 1) {
    const entry = session.entries[index]
    if (entry.type === 'session_info') name = stringValue(entry.raw.name)
  }
  if (name) return name
  // The first user message on the current branch, read from the entry list. A
  // title is shown on every render, so it must not build the whole view: that
  // turned each render into O(session) work on multi-megabyte sessions.
  if (!session.currentLeafId) return session.sourceName
  for (const entry of getPath(session.entries, session.currentLeafId)) {
    if (entry.type !== 'message') continue
    const message = isObject(entry.raw.message) ? entry.raw.message : {}
    if (message.role !== 'user') continue
    return truncate(contentText(message.content))
  }
  return session.sourceName
}
