import { getCurrentSystemMessage } from '@earendil-works/pi-ai/utils/transcript'
import type { SystemMessage } from '@earendil-works/pi-ai'
import type { ParsedEntry, PersistedSystemState, RawObject, SupplementalObservation, ToolSourceInfo } from './types'
import { readObservation } from './observation'

export interface HistoricalPosition {
  state?: PersistedSystemState
  observation?: SupplementalObservation
  sources?: ReadonlyMap<string, ToolSourceInfo>
}
function systemMessage(value: unknown): SystemMessage | undefined {
  if (typeof value !== 'object' || value === null || (value as RawObject).role !== 'system') return
  const message = value as SystemMessage
  return message.content == null ? { ...message, content: '' } : message
}

/** 沿已选分支增量重放：仅在原生状态变更时建立新状态，其他事件共享同一引用。 */
export function replayBranchState(entries: ParsedEntry[]): Map<string, HistoricalPosition> {
  const index = new Map(entries.map((entry, i) => [entry.id, i]))
  const observations = new Map<string, SupplementalObservation>()
  const ambiguous = new Set<string>()
  for (const [i, entry] of entries.entries()) {
    const observation = readObservation(entry.raw)
    if (!observation) continue
    const names = observation.toolSources?.map(tool => tool.name) ?? []
    if (new Set(names).size !== names.length) continue
    const anchor = index.get(observation.anchorEntryId)
    const assistant = index.get(observation.assistantEntryId)
    if (anchor === undefined || assistant === undefined || !(anchor < assistant && assistant < i)) continue
    const target = entries[assistant]
    const message = target.raw.message as RawObject | undefined
    if (target.type !== 'message' || message?.role !== 'assistant' || message.stopReason === 'error' || message.stopReason === 'aborted') continue
    // 不将跨越其他 Assistant 的请求锚点视为可确认的关联。
    if (entries.slice(anchor + 1, assistant).some(e => e.type === 'compaction' || e.type === 'message' && ['assistant', 'system'].includes(String((e.raw.message as RawObject | undefined)?.role)))) continue
    if (observations.has(target.id)) ambiguous.add(target.id)
    else observations.set(target.id, observation)
  }
  for (const id of ambiguous) observations.delete(id)

  const history = new Map<string, HistoricalPosition>()
  let state: PersistedSystemState | undefined
  let lastKnown: PersistedSystemState | undefined
  let sources = new Map<string, ToolSourceInfo>()
  for (const entry of entries) {
    const checkpoint = entry.type === 'compaction'
    const delta = checkpoint ? systemMessage(entry.raw.systemMessage) : entry.type === 'message' ? systemMessage(entry.raw.message) : undefined
    if (checkpoint || delta) {
      const previous = lastKnown
      const message = delta && getCurrentSystemMessage(checkpoint || !state ? [delta] : [state.message, delta])
      state = message ? { entryId: entry.id, message, ...(previous ? { previous: { entryId: previous.entryId, message: previous.message } } : {}) } : undefined
      if (state) lastKnown = state
      if (checkpoint) sources = new Map()
      else if (delta?.toolsAdded?.length || delta?.toolsRemoved?.length) {
        sources = new Map(sources)
        for (const tool of [...(delta.toolsAdded ?? []), ...(delta.toolsRemoved ?? [])]) sources.delete(tool.name)
      }
    }
    const observation = observations.get(entry.id)
    if (observation?.toolSources?.length) {
      sources = new Map(sources)
      for (const {name, sourceInfo} of observation.toolSources) {
        if (sourceInfo && state?.message.toolsAdded?.some(tool => tool.name === name)) sources.set(name, sourceInfo)
        else sources.delete(name)
      }
    }
    history.set(entry.id, { state, observation, sources })
  }
  return history
}

/**
 * 工具定义行展示其后的首次实际请求所确认的来源。
 * 反向关联仅用于声明视图，不修改正向重放的历史调用来源。
 * 任何 Assistant 都结束待关联区间；同名重声明、删除及压缩检查点
 * 也截断对应工具的证据，避免把后续注册信息归给更早的声明。
 */
export function collectToolDefinitionSources(
  entries: ParsedEntry[],
  history: ReadonlyMap<string, HistoricalPosition>,
): Map<string, ReadonlyMap<string, ToolSourceInfo>> {
  const result = new Map<string, ReadonlyMap<string, ToolSourceInfo>>()
  const nextRequestSources = new Map<string, ToolSourceInfo | null>()

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    const position = history.get(entry.id)
    const rawMessage = entry.raw.message as RawObject | undefined
    if (entry.type === 'message' && rawMessage?.role === 'assistant') {
      nextRequestSources.clear()
      const active = new Set(position?.state?.message.toolsAdded?.map(tool => tool.name))
      for (const { name, sourceInfo } of position?.observation?.toolSources ?? []) {
        if (active.has(name)) nextRequestSources.set(name, sourceInfo)
      }
      continue
    }

    const checkpoint = entry.type === 'compaction'
    const delta = checkpoint ? systemMessage(entry.raw.systemMessage)
      : entry.type === 'message' ? systemMessage(entry.raw.message) : undefined
    if (!checkpoint && !delta) continue

    if (position?.state && nextRequestSources.size > 0 &&
      (checkpoint || delta?.toolsAdded?.length || delta?.toolsRemoved?.length)) {
      const sources = new Map(position.sources)
      for (const tool of position.state.message.toolsAdded ?? []) {
        if (!nextRequestSources.has(tool.name)) continue
        const sourceInfo = nextRequestSources.get(tool.name)
        if (sourceInfo) sources.set(tool.name, sourceInfo)
        else sources.delete(tool.name)
      }
      result.set(entry.id, sources)
    }

    if (checkpoint) nextRequestSources.clear()
    else {
      for (const tool of [...(delta?.toolsAdded ?? []), ...(delta?.toolsRemoved ?? [])]) {
        nextRequestSources.delete(tool.name)
      }
    }
  }
  return result
}
