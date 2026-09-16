import type {
  BranchOption,
  ParsedEntry,
  ParsedSession,
  ParseWarning,
  RawObject,
  SessionHeader,
  SessionView,
  SystemPromptComposition,
  TimelineEvent,
  TimelineTurn,
} from './types'
import { truncate } from './format'

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
      if (block.type === 'image') return `[图片 ${stringValue(block.mimeType) ?? '未知格式'}]`
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
        warnings.push({ code: 'cycle', line: cursor.line, message: `第 ${cursor.line} 行形成 parentId 循环，路径已在此处停止。` })
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
    if (!label) label = isCurrent ? '当前路径' : `历史分支 ${index + (currentLeafId ? 0 : 1)}`
    return {
      leafId: leaf.id,
      label,
      timestamp: leaf.timestamp,
      isCurrent,
    }
  })
}

export function parseSessionJsonl(content: string, sourceName = '本地文件'): ParsedSession {
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
      warnings.push({ code: 'invalid-json', line: lineNumber, message: `第 ${lineNumber} 行不是完整 JSON，已跳过。` })
      continue
    }

    if (!isObject(raw)) {
      warnings.push({ code: 'invalid-entry', line: lineNumber, message: `第 ${lineNumber} 行不是 JSON 对象，已跳过。` })
      continue
    }

    if (!header && raw.type === 'session') {
      header = raw as SessionHeader
      continue
    }

    const id = stringValue(raw.id)
    const type = stringValue(raw.type)
    if (!id || !type) {
      warnings.push({ code: 'invalid-entry', line: lineNumber, message: `第 ${lineNumber} 行缺少 id 或 type，已跳过。` })
      continue
    }
    if (seenIds.has(id)) {
      warnings.push({ code: 'duplicate-id', line: lineNumber, message: `第 ${lineNumber} 行的 id “${id}” 重复，已跳过。` })
      continue
    }
    seenIds.add(id)
    if (!KNOWN_ENTRY_TYPES.has(type)) {
      warnings.push({ code: 'unknown-type', line: lineNumber, message: `第 ${lineNumber} 行包含未知事件类型 “${type}”，仍会保留。` })
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
    warnings.unshift({ code: 'invalid-header', message: '没有找到 type 为 session 的文件头；已尝试解析其余入口。' })
  }

  const ids = new Set(entries.map((entry) => entry.id))
  for (const entry of entries) {
    if (entry.parentId && !ids.has(entry.parentId)) {
      warnings.push({
        code: 'missing-parent',
        line: entry.line,
        message: `第 ${entry.line} 行引用了不存在的 parentId “${entry.parentId}”。`,
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

function messageEvents(entry: ParsedEntry): TimelineEvent[] {
  const message = isObject(entry.raw.message) ? entry.raw.message : {}
  const role = stringValue(message.role) ?? 'unknown'
  const timestamp = timestampValue(entry, message)

  if (role === 'user') {
    const content = contentText(message.content)
    return [{
      id: `${entry.id}:user`, entryId: entry.id, kind: 'user', title: '用户', summary: truncate(content),
      content, timestamp, durationMs: durationValue(message), raw: entry.raw,
    }]
  }

  if (role === 'toolResult') {
    const content = contentText(message.content)
    const toolName = stringValue(message.toolName) ?? '未知工具'
    const isError = message.isError === true
    return [{
      id: `${entry.id}:result`, entryId: entry.id, kind: 'tool-result',
      title: `${toolName} 返回${isError ? '失败' : '结果'}`, summary: truncate(content), content,
      timestamp, durationMs: durationValue(message), toolCallId: stringValue(message.toolCallId), toolName,
      isError, raw: entry.raw,
    }]
  }

  if (role !== 'assistant') {
    const content = contentText(message.content)
    return [{
      id: `${entry.id}:message`, entryId: entry.id, kind: 'system', title: `消息：${role}`,
      summary: truncate(content), content, timestamp, raw: entry.raw,
    }]
  }

  const blocks = Array.isArray(message.content) ? message.content : []
  const events: TimelineEvent[] = []
  let textBuffer: string[] = []
  let textStartIndex = 0

  const flushText = () => {
    if (!textBuffer.length) return
    const content = textBuffer.join('\n\n')
    events.push({
      id: `${entry.id}:assistant:${textStartIndex}`, entryId: entry.id, kind: 'assistant', title: 'Pi 回复',
      summary: truncate(content), content, timestamp, durationMs: durationValue(message), raw: entry.raw,
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
        summary: truncate(content), content, timestamp, raw: { entry: entry.raw, block },
      })
    } else if (block.type === 'toolCall') {
      const toolName = stringValue(block.name) ?? '未知工具'
      const toolCallId = stringValue(block.id)
      const content = JSON.stringify(block.arguments ?? {}, null, 2)
      events.push({
        id: `${entry.id}:tool:${index}`, entryId: entry.id, kind: 'tool-call', title: `调用 ${toolName}`,
        summary: truncate(content), content, timestamp, durationMs: durationValue(block), toolCallId, toolName,
        raw: { entry: entry.raw, block },
      })
    } else if (block.type === 'image') {
      events.push({
        id: `${entry.id}:image:${index}`, entryId: entry.id, kind: 'assistant', title: 'Pi 回复',
        summary: `[图片 ${stringValue(block.mimeType) ?? '未知格式'}]`, content: '[首版不专门渲染图片内容]',
        timestamp, raw: { entry: entry.raw, block },
      })
    }
  })
  flushText()

  if (!events.length) {
    events.push({
      id: `${entry.id}:assistant`, entryId: entry.id, kind: 'assistant', title: 'Pi 回复', summary: '无文本内容',
      content: '', timestamp, durationMs: durationValue(message), raw: entry.raw,
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
        path: stringValue(file.path) ?? '未知路径',
        content: stringValue(file.content) ?? '',
      }))
    : []
  const skills = Array.isArray(value.skills)
    ? value.skills.filter(isObject).map((skill) => ({
        name: stringValue(skill.name) ?? '未命名 skill',
        description: stringValue(skill.description) ?? '',
        filePath: stringValue(skill.filePath) ?? '',
        baseDir: stringValue(skill.baseDir),
        disableModelInvocation: skill.disableModelInvocation === true,
      }))
    : []
  return {
    customPrompt: stringValue(value.customPrompt),
    selectedTools: stringArray(value.selectedTools),
    toolSnippets: stringRecord(value.toolSnippets),
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
  const summaryParts = [promptLength != null ? `${promptLength.toLocaleString('zh-CN')} 字符` : '长度未知']
  if (composition?.selectedTools.length) summaryParts.push(`${composition.selectedTools.length} 个工具`)
  if (composition?.contextFiles.length) summaryParts.push(`${composition.contextFiles.length} 个上下文文件`)
  if (composition?.skills.length) summaryParts.push(`${composition.skills.length} 个 skills`)

  return {
    id: `${entry.id}:system-prompt`,
    entryId: entry.id,
    kind: 'system-prompt',
    title: prompt ? (captureStage === 'provider_request_update' ? '系统提示词更新' : '系统提示词') : '系统提示词快照缺失',
    summary: prompt ? summaryParts.join(' · ') : `无法解析哈希 ${hash ?? '未知'} 的提示词快照`,
    content: prompt ?? '该引用对应的完整系统提示词快照不在当前会话文件中。',
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
    raw: entry.raw,
  }
}

function systemEvent(entry: ParsedEntry, snapshots: Map<string, PromptSnapshotData>): TimelineEvent {
  const capturedPrompt = capturedSystemPromptEvent(entry, snapshots)
  if (capturedPrompt) return capturedPrompt

  const raw = entry.raw
  const labels: Record<string, string> = {
    model_change: '模型切换',
    thinking_level_change: 'Thinking 等级切换',
    compaction: '上下文压缩',
    branch_summary: '分支摘要',
    custom: `自定义事件：${stringValue(raw.customType) ?? '未命名'}`,
    custom_message: `自定义消息：${stringValue(raw.customType) ?? '未命名'}`,
    label: '分支标签',
    session_info: '会话信息',
  }
  let content = ''
  if (entry.type === 'model_change') content = `${stringValue(raw.provider) ?? '未知提供方'} / ${stringValue(raw.modelId) ?? '未知模型'}`
  else if (entry.type === 'thinking_level_change') content = stringValue(raw.thinkingLevel) ?? ''
  else if (entry.type === 'compaction' || entry.type === 'branch_summary') content = stringValue(raw.summary) ?? ''
  else if (entry.type === 'custom_message') content = contentText(raw.content)
  else if (entry.type === 'session_info') content = stringValue(raw.name) ?? ''
  else if (entry.type === 'label') content = stringValue(raw.label) ?? ''
  else content = JSON.stringify(raw.data ?? raw, null, 2)

  return {
    id: `${entry.id}:system`, entryId: entry.id, kind: 'system', title: labels[entry.type] ?? `未知事件：${entry.type}`,
    summary: truncate(content), content, timestamp: entry.timestamp, durationMs: durationValue(raw), raw,
  }
}

function pairTools(events: TimelineEvent[]): void {
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
    if (event.kind === 'tool-call' && event.toolCallId) calls.set(event.toolCallId, event)
    if (event.kind === 'tool-result' && event.toolCallId) {
      const call = calls.get(event.toolCallId)
      if (call) {
        call.pairedEventId = event.id
        event.pairedEventId = call.id
      }
    }
  }
}

function missingSystemPromptEvent(user: TimelineEvent): TimelineEvent {
  return {
    id: `missing-system-prompt:${user.entryId}`,
    entryId: `missing-system-prompt:${user.entryId}`,
    kind: 'system-prompt',
    title: '系统提示词未记录',
    summary: '该轮发生在捕获扩展启用之前，无法准确恢复。',
    content: '这个 session JSONL 没有保存该轮实际使用的系统提示词。为保证准确性，面板不会根据当前文件和配置推测历史内容。',
    timestamp: user.timestamp,
    targetEntryId: user.entryId,
    systemPrompt: { recordType: 'missing' },
    raw: { type: 'synthetic', reason: 'system-prompt-not-captured', targetUserEntryId: user.entryId },
  }
}

function placeSystemPromptsBeforeUsers(events: TimelineEvent[]): TimelineEvent[] {
  const promptsByUser = new Map<string, TimelineEvent[]>()
  for (const event of events) {
    if (event.kind !== 'system-prompt' || !event.targetEntryId) continue
    const prompts = promptsByUser.get(event.targetEntryId) ?? []
    prompts.push(event)
    promptsByUser.set(event.targetEntryId, prompts)
  }

  const placed = new Set<string>()
  const ordered: TimelineEvent[] = []
  for (const event of events) {
    if (event.kind === 'system-prompt' && event.targetEntryId) continue
    if (event.kind === 'user') {
      const prompts = promptsByUser.get(event.entryId) ?? [missingSystemPromptEvent(event)]
      prompts.forEach((prompt, index) => {
        prompt.timestamp = event.timestamp
        prompt.gapMs = index === 0 ? event.gapMs : 0
        placed.add(prompt.id)
        ordered.push(prompt)
      })
      event.gapMs = 0
    }
    ordered.push(event)
  }

  for (const event of events) {
    if (event.kind === 'system-prompt' && event.targetEntryId && !placed.has(event.id)) ordered.push(event)
  }
  return ordered
}

function groupTurns(events: TimelineEvent[]): TimelineTurn[] {
  const turns: TimelineTurn[] = []
  const promptPrelude: TimelineEvent[] = []
  let current: TimelineTurn | undefined
  let turnIndex = 0

  for (const event of events) {
    if (event.kind === 'system-prompt' && event.targetEntryId) {
      promptPrelude.push(event)
      continue
    }
    if (event.kind === 'user') {
      turnIndex += 1
      current = { id: `turn-${turnIndex}`, index: turnIndex, label: `第 ${turnIndex} 轮`, events: [], startedAt: event.timestamp }
      current.events.push(...promptPrelude.splice(0))
      turns.push(current)
    } else if (!current) {
      current = { id: 'turn-setup', index: 0, label: '会话设置', events: [] }
      turns.push(current)
    }
    current.events.push(event)
    current.endedAt = event.timestamp ?? current.endedAt
  }

  if (promptPrelude.length > 0) {
    if (!current) {
      current = { id: 'turn-setup', index: 0, label: '会话设置', events: [] }
      turns.push(current)
    }
    current.events.push(...promptPrelude)
  }
  return turns
}

export function buildSessionView(session: ParsedSession, requestedLeafId?: string | null): SessionView {
  const leafId = requestedLeafId && session.entries.some((entry) => entry.id === requestedLeafId)
    ? requestedLeafId
    : session.currentLeafId
  const branchEntries = leafId ? getPath(session.entries, leafId) : []
  const snapshots = collectPromptSnapshots(session.entries)
  const rawEvents = branchEntries.flatMap((entry) => entry.type === 'message' ? messageEvents(entry) : [systemEvent(entry, snapshots)])
  pairTools(rawEvents)
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
