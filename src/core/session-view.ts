import type {
  ContextProjection,
  ParsedEntry,
  ParsedSession,
  RawObject,
  SessionStats,
  SessionView,
  TimelineEvent,
  TimelineTurn,
} from './types'
import { truncate } from './format'
import { extractSubagentReferences, normalizeSessionRelativePath, subagentReferencesAlias, workflowChildTranscriptPath } from './subagent-detector'
import { getPath } from './session-parser'
import { collectToolDefinitionSources, replayBranchState, type PersistedSystemState } from './native-state'
import { getSystemMessageText } from '@earendil-works/pi-ai/utils/text'
import { isViewerRecord } from './observation'
import { sanitizeToolForApi } from './tool-provenance'

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

function piSystemContextEvent(
  entry: ParsedEntry,
  message: RawObject,
  timestamp: string | undefined,
  isInitialSystemMessage: boolean,
  state?: PersistedSystemState,
): TimelineEvent {
  const sections = isObject(message.sections) ? Object.entries(message.sections) : []
  const toolsAdded = Array.isArray(message.toolsAdded) ? message.toolsAdded.filter(isObject) : []
  const toolsRemoved = Array.isArray(message.toolsRemoved) ? message.toolsRemoved : []
  const hasFullSnapshot = isInitialSystemMessage
    && (typeof message.content === 'string' && message.content.length > 0
      || sections.some(([name, value]) => name === 'preamble' && typeof value === 'string'))
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
  // 正文使用 Pi 原生提示词渲染；分区名及工具声明不属于提示词正文。
  const content = state ? getSystemMessageText(state.message) : ''

  return {
    id: `${entry.id}:system-context`, entryId: entry.id, kind: 'system-prompt',
    title: hasFullSnapshot ? 'Pi system context snapshot' : 'Pi system context update',
    summary: summaryParts.join(' · ') || truncate(content),
    content, timestamp, raw: entry.raw,
  }
}

function messageEvents(entry: ParsedEntry, sourceName?: string, isInitialSystemMessage = false, state?: PersistedSystemState): TimelineEvent[] {
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
    return [piSystemContextEvent(entry, message, timestamp, isInitialSystemMessage, state)]
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

function systemEvents(entry: ParsedEntry): TimelineEvent[] {
  if (isViewerRecord(entry.raw)) return []

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
    id: `${entry.id}:system`, entryId: entry.id, kind: entry.type === 'compaction' ? 'system-prompt' : 'system', title: labels[entry.type] ?? `Unknown event: ${entry.type}`,
    summary: truncate(content), content, timestamp: entry.timestamp, durationMs: durationValue(raw), model, raw,
  }]
}

function pairTools(events: TimelineEvent[], sourceName?: string): void {
  const calls = new Map<string, TimelineEvent>()
  let previousTimestamp: number | undefined

  for (const event of events) {
    if (event.timestamp) {
      const time = new Date(event.timestamp).getTime()
      if (Number.isFinite(time)) {
        if (previousTimestamp != null) event.gapMs = Math.max(0, time - previousTimestamp)
        previousTimestamp = time
      }
    }
    if (event.kind === 'tool-call') {
      if (event.toolCallId) calls.set(event.toolCallId, event)
    }
    if (event.kind === 'tool-result' && event.toolCallId) {
      const call = calls.get(event.toolCallId)
      if (call) {
        call.pairedEventId = event.id
        event.pairedEventId = call.id
        if (call.toolDefinition) {
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
        if (effectiveSubagents?.length) {
          call.subagent = effectiveSubagents[0]
          call.subagents = effectiveSubagents.length > 1 ? effectiveSubagents : undefined
          delete event.subagent
          delete event.subagents
        }
      }
    }
  }
}

function attachSubagentReference(
  event: TimelineEvent,
  reference: NonNullable<TimelineEvent['subagent']>,
  parentSourcePath?: string,
): void {
  const references = event.subagents ?? (event.subagent ? [event.subagent] : [])
  const alreadyLinked = references.some((existing) => subagentReferencesAlias(existing, reference, parentSourcePath))
  if (alreadyLinked) return

  const combined = [...references, reference]
  event.subagent = combined[0]
  event.subagents = combined.length > 1 ? combined : undefined
}

/**
 * Link pi-subagents' asynchronous completion notices and workflow children to
 * the tool call that launched them. Notices are separate custom_message entries,
 * so pairTools cannot associate their session references with the invocation.
 */
function linkAsyncSubagentNotifications(events: TimelineEvent[], sourceName?: string): void {
  const relativeSourceName = sourceName ? normalizeSessionRelativePath(sourceName) : undefined
  const resultsByRunId = new Map<string, TimelineEvent[]>()
  const callsById = new Map(events
    .filter((event) => event.kind === 'tool-call' && event.toolCallId)
    .map((event) => [event.id, event]))

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
      if (!runId) continue

      const matches = resultsByRunId.get(runId)
      if (matches?.length !== 1) continue
      const result = matches[0]
      const invocation = result.pairedEventId ? callsById.get(result.pairedEventId) : undefined
      if (!invocation) continue
      const resultMessage = isObject(result.raw) && isObject(result.raw.message) ? result.raw.message : undefined
      const resultDetails = resultMessage && isObject(resultMessage.details) ? resultMessage.details : undefined
      const detailToolCallId = stringValue(resultDetails?.toolCallId)
      if (detailToolCallId && detailToolCallId !== result.toolCallId) continue

      const sessionValue = stringValue(run.sessionValue)
      if (sessionValue?.toLowerCase().endsWith('.jsonl')) {
        const reference = extractSubagentReferences('subagent', {
          sessionFile: sessionValue,
          agent: run.agent,
          task: run.task,
          sessionName: run.sessionLabel,
          runId,
        }, undefined, undefined, relativeSourceName)[0]
        if (reference) attachSubagentReference(invocation, reference, relativeSourceName)
      }

      if (!Array.isArray(run.childRuns)) continue
      const outputsByRunId = new Map(
        (Array.isArray(run.childOutputs) ? run.childOutputs : [])
          .filter(isObject)
          .map((child) => [stringValue(child.runId), child] as const)
          .filter((item): item is readonly [string, RawObject] => Boolean(item[0])),
      )
      for (const childRun of run.childRuns) {
        if (!isObject(childRun)) continue
        const childRunId = stringValue(childRun.runId)
        const output = childRunId ? outputsByRunId.get(childRunId) : undefined
        const agentName = stringValue(childRun.agent) ?? stringValue(output?.agent)
        if (!childRunId || !agentName) continue

        const childSessionValue = stringValue(childRun.sessionValue) ?? stringValue(childRun.sessionFile)
        const sessionFile = childSessionValue?.toLowerCase().endsWith('.jsonl')
          ? childSessionValue
          : workflowChildTranscriptPath(childRunId, agentName, stringValue(output?.outputArtifactPath), relativeSourceName)
        if (!sessionFile) continue

        const reference = extractSubagentReferences('subagent', {
          sessionFile,
          agent: agentName,
          task: childRun.task,
          sessionName: childRun.sessionName ?? childRun.workflowKey,
          runId: childRunId,
        }, undefined, undefined, relativeSourceName)[0]
        if (reference) attachSubagentReference(invocation, reference, relativeSourceName)
      }
    }
  }
}

function groupTurns(events: TimelineEvent[]): TimelineTurn[] {
  const turns: TimelineTurn[] = []
  let current: TimelineTurn | undefined
  let turnIndex = 0
  let groupIndex = 0

  for (const event of events) {
    if (event.kind === 'user') {
      groupIndex += 1
      turnIndex += 1
      current = {
        id: `turn-${turnIndex}`,
        index: groupIndex, label: `Turn ${turnIndex}`,
        events: [], startedAt: event.timestamp,
      }
      turns.push(current)
    } else if (!current) {
      current = { id: 'turn-setup', index: 0, label: 'Session setup', events: [] }
      turns.push(current)
    }
    current.events.push(event)
    current.endedAt = event.timestamp ?? current.endedAt
  }
  return turns
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
  'tool-definitions': 0,
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
  const firstSystemMessageId = branchEntries.find((entry) => (
    entry.type === 'message' && isObject(entry.raw.message) && entry.raw.message.role === 'system'
  ))?.id
  const history = replayBranchState(branchEntries)
  const definitionSources = collectToolDefinitionSources(branchEntries, history)
  let toolDefinitionsEntryId: string | undefined
  const events = branchEntries.flatMap((entry) => {
    const position = history.get(entry.id)
    const state = position?.state
    const rows = entry.type === 'message'
      ? messageEvents(entry, session.sourceName, entry.id === firstSystemMessageId, state)
      : systemEvents(entry)
    const native = entry.type === 'compaction' ? entry.raw.systemMessage : entry.raw.message
    if (!state) toolDefinitionsEntryId = undefined
    // 工具定义行与原生声明/压缩检查点使用同一条 JSONL 原始记录。
    // 普通消息、补充来源记录及无工具变化的提示词更新不生成额外事件。
    if (state && state.entryId === entry.id && isObject(native)) {
      const declared = Array.isArray(native.toolsAdded) && native.toolsAdded.length > 0
        || Array.isArray(native.toolsRemoved) && native.toolsRemoved.length > 0
      const checkpoint = entry.type === 'compaction'
      if (declared || checkpoint && (state.message.toolsAdded?.length || toolDefinitionsEntryId)) {
        const sources = definitionSources.get(entry.id) ?? position?.sources
        const tools = (state.message.toolsAdded ?? []).map(tool => ({
          ...tool, sourceInfo: sources?.get(tool.name),
        }))
        toolDefinitionsEntryId = entry.id
        rows.push({
          id: `${entry.id}:tool-definitions`, entryId: entry.id, kind: 'tool-definitions',
          title: 'Tool Definitions', summary: tools.length > 0 ? `Mounted ${tools.length} API tools` : 'No active API tools',
          content: JSON.stringify(tools.map(sanitizeToolForApi), null, 2),
          timestamp: rows[0]?.timestamp ?? entry.timestamp, raw: entry.raw, toolDefinitions: tools,
        })
      } else if (checkpoint) {
        toolDefinitionsEntryId = undefined
      }
    }
    for (const row of rows) {
      row.persistedState = state
      row.observation = position?.observation
      row.toolSources = position?.sources
      row.toolDefinitionsEntryId = toolDefinitionsEntryId
      if (row.kind === 'tool-call' && row.toolName) {
        const tool = state?.message.toolsAdded?.find(tool => tool.name === row.toolName)
        const sourceInfo = position?.sources?.get(row.toolName)
        if (tool) row.toolDefinition = { ...tool, ...(sourceInfo ? { sourceInfo } : {}) }
      }
    }
    return rows
  })
  pairTools(events, session.sourceName)
  linkAsyncSubagentNotifications(events, session.sourceName)
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

  const timestamps = events
    .map((event) => event.timestamp ? new Date(event.timestamp).getTime() : Number.NaN)
    .filter(Number.isFinite)
  const startedAt = session.header?.timestamp ?? events.find((event) => event.timestamp)?.timestamp
  let endedAt: string | undefined
  for (let index = events.length - 1; index >= 0 && !endedAt; index -= 1) {
    endedAt = events[index].timestamp
  }
  const startMs = startedAt ? new Date(startedAt).getTime() : timestamps[0]
  const endMs = endedAt ? new Date(endedAt).getTime() : timestamps.at(-1)
  const elapsedMs = typeof startMs === 'number' && Number.isFinite(startMs)
    && typeof endMs === 'number' && Number.isFinite(endMs)
    ? Math.max(0, endMs - startMs)
    : undefined

  const stats: SessionStats = {
    entryCount: session.entries.length,
    turnCount: turns.filter((turn) => turn.index > 0).length,
    startedAt,
    endedAt,
    elapsedMs,
  }

  return { branchEntries, events, turns, stats }
}
