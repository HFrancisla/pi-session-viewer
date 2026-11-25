import type { BuildSystemPromptOptions, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { OBSERVATION_TYPE, type SupplementalObservation } from '../core/observation'
import { replayBranchState } from '../core/native-state'
import type { ParsedEntry, ToolSourceInfo } from '../core/types'
import { resolvePiVersion } from '../server/pi-runtime'

interface PendingRequest {
  sessionId: string
  anchorEntryId: string
  forcedPrompt?: string
  toolSources: Map<string, ToolSourceInfo>
}

/** 只记录实际观察的 Harness 覆盖与注册来源，不读取 Provider payload。 */
export default function registerObservation(pi: ExtensionAPI): void {
  let options: BuildSystemPromptOptions | undefined
  let request: PendingRequest | undefined
  let requestCount = 0
  const resetRound = () => { request = undefined; requestCount = 0 }
  const resetSession = () => { resetRound(); options = undefined }

  pi.on('session_start', resetSession)
  pi.on('session_tree', resetSession)
  pi.on('before_agent_start', event => { resetRound(); options = event.systemPromptOptions })
  pi.on('turn_start', resetRound)
  pi.on('agent_end', resetSession)
  pi.on('before_provider_request', (_event, ctx) => {
    requestCount++
    request = undefined
    if (requestCount !== 1 || !options) return
    const anchorEntryId = ctx.sessionManager.getLeafId()
    if (!anchorEntryId) return
    const active = new Set(pi.getActiveTools())
    const hidden = new Set(options.hiddenTools ?? [])
    const toolSources = new Map<string, ToolSourceInfo>()
    for (const tool of pi.getAllTools()) {
      if (!active.has(tool.name) || hidden.has(tool.name) || !tool.sourceInfo) continue
      const sourceInfo: ToolSourceInfo = {}
      for (const key of ['path', 'source', 'scope', 'origin', 'baseDir'] as const) {
        const value = (tool.sourceInfo as unknown as ToolSourceInfo)[key]
        if (typeof value === 'string') sourceInfo[key] = value
      }
      if (Object.keys(sourceInfo).length) toolSources.set(tool.name, sourceInfo)
    }
    request = {
      sessionId: ctx.sessionManager.getSessionId(), anchorEntryId,
      forcedPrompt: typeof options.forceSystemPrompt === 'string' ? options.forceSystemPrompt : undefined,
      toolSources,
    }
  })
  pi.on('turn_end', (event, ctx) => {
    const pending = request
    resetRound()
    if (!pending || event.message.role !== 'assistant' || event.outcome !== 'completed'
      || pending.sessionId !== ctx.sessionManager.getSessionId()) return
    const branch = ctx.sessionManager.getBranch()
    const anchorIndex = branch.findIndex(entry => entry.id === pending.anchorEntryId)
    const assistantIndex = branch.findIndex(entry => entry.id === event.messageEntryId)
    if (anchorIndex < 0 || assistantIndex <= anchorIndex
      || branch.slice(anchorIndex + 1, assistantIndex).some(entry => entry.type === 'compaction' || entry.type === 'message' && ['assistant', 'system'].includes(entry.message.role))) return
    const piVersion = resolvePiVersion()
    if (!piVersion) return
    const entries: ParsedEntry[] = branch.slice(0, assistantIndex + 1).map((entry, line) => ({
      id: entry.id, parentId: entry.parentId, type: entry.type, timestamp: entry.timestamp,
      line: line + 1, raw: entry as unknown as ParsedEntry['raw'],
    }))
    const position = replayBranchState(entries).get(event.messageEntryId)
    const toolSources: NonNullable<SupplementalObservation['toolSources']> = []
    for (const tool of position?.state?.message.toolsAdded ?? []) {
      const previous = position?.sources?.get(tool.name)
      const current = pending.toolSources.get(tool.name)
      if (JSON.stringify(previous) !== JSON.stringify(current)) {
        toolSources.push({ name: tool.name, sourceInfo: current ?? null })
      }
    }
    if (pending.forcedPrompt === undefined && !toolSources.length) return
    const observation: SupplementalObservation = {
      schemaVersion: 1, piVersion, anchorEntryId: pending.anchorEntryId,
      assistantEntryId: event.messageEntryId,
      ...(pending.forcedPrompt !== undefined ? { forcedPrompt: pending.forcedPrompt } : {}),
      ...(toolSources.length ? { toolSources } : {}),
    }
    pi.appendEntry(OBSERVATION_TYPE, observation)
  })
}
