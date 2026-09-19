import type {
  BranchOption,
  CapturedToolDefinition,
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
import { extractSubagentReference, extractSubagentReferences } from './subagent-detector'

const KNOWN_ENTRY_TYPES = new Set([
  'message',
  'model_change',
  'thinking_level_change',
  'compaction',
  'branch_summary',
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

function messageEvents(entry: ParsedEntry, sourceName?: string): TimelineEvent[] {
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
  const prompt = snapshot ? stringValue(snapshot.prompt) : undefined
  const composition = promptComposition(snapshot?.composition)
  const promptLength = typeof data.promptLength === 'number' ? data.promptLength : prompt?.length
  const modelValue = isObject(data.model) ? data.model : undefined
  const recordType = data.recordType === 'reference' ? 'reference' : 'snapshot'
  const captureStage = data.captureStage === 'provider_request_update' ? 'provider_request_update' : 'agent_start'
  const summaryParts: string[] = []
  if (composition?.skills.length) summaryParts.push(`Mounted ${composition.skills.length} ${composition.skills.length === 1 ? 'skill' : 'skills'}`)
  if (composition?.contextFiles.length) summaryParts.push(`${composition.contextFiles.length} context ${composition.contextFiles.length === 1 ? 'file' : 'files'}`)
  const defaultSummary = recordType === 'snapshot' ? 'Full snapshot' : recordType === 'reference' ? 'Snapshot reference' : 'System prompt'

  return {
    id: `${entry.id}:system-prompt`,
    entryId: entry.id,
    kind: 'system-prompt',
    title: prompt ? (captureStage === 'provider_request_update' ? 'System prompt update' : 'System prompt') : 'System prompt missing',
    summary: prompt ? (summaryParts.length ? summaryParts.join(' · ') : defaultSummary) : `Unable to resolve prompt snapshot for hash ${hash ?? 'unknown'}`,
    content: prompt ?? 'The complete system prompt snapshot for this reference is not in the current session file.',
    timestamp: entry.timestamp,
    targetEntryId: stringValue(data.targetUserEntryId),
    systemPrompt: {
      promptHash: hash,
      recordType,
      captureStage,
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

function systemEvents(entry: ParsedEntry, snapshots: Map<string, PromptSnapshotData>): TimelineEvent[] {
  const capturedPrompt = capturedSystemPromptEvent(entry, snapshots)
  if (capturedPrompt) {
    const list = [capturedPrompt]
    const toolEvent = buildToolDefinitionsEvent(capturedPrompt)
    if (toolEvent) list.push(toolEvent)
    return list
  }

  const raw = entry.raw
  const labels: Record<string, string> = {
    model_change: 'Model Switch',
    thinking_level_change: 'Thinking Level Switch',
    compaction: 'Context Compaction',
    branch_summary: 'Branch Summary',
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

function missingSystemPromptEvent(user: TimelineEvent): TimelineEvent {
  return {
    id: `missing-system-prompt:${user.entryId}`,
    entryId: `missing-system-prompt:${user.entryId}`,
    kind: 'system-prompt',
    title: 'System prompt unrecorded',
    summary: 'This turn occurred before the capture extension was loaded and cannot be restored.',
    content: 'This session JSONL does not contain the system prompt for this turn. To maintain accuracy, historical prompts are never guessed from current configuration.',
    timestamp: user.timestamp,
    targetEntryId: user.entryId,
    systemPrompt: { recordType: 'missing' },
    raw: { type: 'synthetic', reason: 'system-prompt-not-captured', targetUserEntryId: user.entryId },
  }
}

function placeSystemPromptsBeforeUsers(events: TimelineEvent[]): TimelineEvent[] {
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
        const prompts = candidatePrompts ?? [missingSystemPromptEvent(event)]
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

  for (const event of events) {
    if ((event.kind === 'system-prompt' || event.kind === 'tool-definitions') && event.targetEntryId) {
      promptPrelude.push(event)
      continue
    }
    if (event.kind === 'user') {
      turnIndex += 1
      current = { id: `turn-${turnIndex}`, index: turnIndex, label: `Turn ${turnIndex}`, events: [], startedAt: event.timestamp }
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

export function buildSessionView(session: ParsedSession, requestedLeafId?: string | null): SessionView {
  const leafId = requestedLeafId && session.entries.some((entry) => entry.id === requestedLeafId)
    ? requestedLeafId
    : session.currentLeafId
  const branchEntries = leafId ? getPath(session.entries, leafId) : []
  const snapshots = collectPromptSnapshots(session.entries)
  const rawEvents = branchEntries.flatMap((entry) => entry.type === 'message' ? messageEvents(entry, session.sourceName) : systemEvents(entry, snapshots))
  pairTools(rawEvents, session.sourceName)
  inferMissingPromptTargets(rawEvents)
  const events = placeSystemPromptsBeforeUsers(rawEvents)
  return { branchEntries, events, turns: groupTurns(events) }
}

export function getSessionTitle(session: ParsedSession): string {
  let name: string | undefined
  for (let index = session.entries.length - 1; index >= 0 && !name; index -= 1) {
    const entry = session.entries[index]
    if (entry.type === 'session_info') name = stringValue(entry.raw.name)
  }
  if (name) return name
  const firstUser = buildSessionView(session, session.currentLeafId).events.find((event) => event.kind === 'user')
  return firstUser?.summary ?? session.sourceName
}
