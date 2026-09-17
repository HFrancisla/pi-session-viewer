import { createHash } from 'node:crypto'
import type { BuildSystemPromptOptions, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { CapturedToolDefinition } from '../core/types'

export const SYSTEM_PROMPT_ENTRY_TYPE = 'pi-session-viewer.system-prompt'

interface PendingCapture {
  targetUserEntryId?: string
  options: SerializablePromptOptions
  promptAtCapture: string
  recordedInitial?: boolean
}

interface SerializablePromptOptions {
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
    baseDir: string
    disableModelInvocation: boolean
  }>
}

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex')
}

function serializeOptions(options: BuildSystemPromptOptions): SerializablePromptOptions {
  return {
    customPrompt: options.customPrompt,
    selectedTools: [...(options.selectedTools ?? [])],
    toolSnippets: { ...(options.toolSnippets ?? {}) },
    promptGuidelines: [...(options.promptGuidelines ?? [])],
    appendSystemPrompt: options.appendSystemPrompt,
    cwd: options.cwd,
    contextFiles: (options.contextFiles ?? []).map((file) => ({ path: file.path, content: file.content })),
    skills: (options.skills ?? []).map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      baseDir: skill.baseDir,
      disableModelInvocation: skill.disableModelInvocation,
    })),
  }
}

function latestUserEntryId(entries: unknown): string | undefined {
  if (!Array.isArray(entries)) return undefined
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (
      entry && typeof entry === 'object'
      && 'type' in entry && entry.type === 'message'
      && 'message' in entry && entry.message
      && typeof entry.message === 'object'
      && 'role' in entry.message && entry.message.role === 'user'
      && 'id' in entry && typeof entry.id === 'string'
    ) {
      return entry.id
    }
  }
  return undefined
}

function recordPrompt(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  pending: PendingCapture | undefined,
  captureStage: 'agent_start' | 'provider_request_update',
  forceReference: boolean,
  knownPromptHashes: Set<string>,
  sequence: { value: number },
  lastRecordedHash: { value?: string },
  targetUserEntryId?: string,
): void {
  if (!pending) return
  const prompt = ctx.getSystemPrompt()
  const hash = promptHash(prompt)
  if (!forceReference && hash === lastRecordedHash.value) return
  const isNewSnapshot = !knownPromptHashes.has(hash)
  sequence.value += 1
  const allTools = typeof pi.getAllTools === 'function' ? pi.getAllTools() : []
  const activeToolNames = new Set(typeof pi.getActiveTools === 'function' ? pi.getActiveTools() : [])
  const activeTools = activeToolNames.size > 0
    ? allTools.filter((tool) => activeToolNames.has(tool.name))
    : allTools
  const toolDefinitions: CapturedToolDefinition[] = activeTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    promptGuidelines: tool.promptGuidelines,
  }))
  const composition = {
    ...pending.options,
    selectedTools: [...pi.getActiveTools()],
    toolDefinitions: toolDefinitions.length > 0 ? toolDefinitions : undefined,
  }

  pi.appendEntry(SYSTEM_PROMPT_ENTRY_TYPE, {
    schemaVersion: 1,
    recordType: isNewSnapshot ? 'snapshot' : 'reference',
    captureStage,
    promptHash: hash,
    prompt: isNewSnapshot ? prompt : undefined,
    promptLength: prompt.length,
    composition: isNewSnapshot ? composition : undefined,
    promptBeforeFinalExtensions: isNewSnapshot && pending.promptAtCapture !== prompt ? pending.promptAtCapture : undefined,
    targetUserEntryId,
    relatedUserEntryId: targetUserEntryId ?? pending.targetUserEntryId,
    sequence: sequence.value,
    capturedAt: new Date().toISOString(),
    model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
  })

  if (isNewSnapshot) knownPromptHashes.add(hash)
  lastRecordedHash.value = hash
}

export default function systemPromptCapture(pi: ExtensionAPI): void {
  const knownPromptHashes = new Set<string>()
  const sequence = { value: 0 }
  const lastRecordedHash: { value?: string } = {}
  let pending: PendingCapture | undefined

  pi.on('session_start', (_event, ctx) => {
    knownPromptHashes.clear()
    sequence.value = 0
    pending = undefined
    lastRecordedHash.value = undefined
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== 'custom' || entry.customType !== SYSTEM_PROMPT_ENTRY_TYPE) continue
      const data = entry.data
      if (!data || typeof data !== 'object') continue
      if ('promptHash' in data && typeof data.promptHash === 'string' && 'prompt' in data && typeof data.prompt === 'string') {
        knownPromptHashes.add(data.promptHash)
      }
      if ('sequence' in data && typeof data.sequence === 'number') sequence.value = Math.max(sequence.value, data.sequence)
    }
  })

  pi.on('before_agent_start', (event) => {
    pending = {
      options: serializeOptions(event.systemPromptOptions),
      promptAtCapture: event.systemPrompt,
      recordedInitial: false,
    }
  })

  pi.on('agent_start', () => {
    // Prompt snapshot writing is deferred to before_provider_request once the turn's user entry is persisted.
  })

  pi.on('before_provider_request', (_event, ctx) => {
    if (!pending) return

    if (!pending.recordedInitial) {
      const userEntryId = latestUserEntryId(ctx.sessionManager.getBranch())
      pending.targetUserEntryId = userEntryId
      recordPrompt(
        ctx,
        pi,
        pending,
        'agent_start',
        true,
        knownPromptHashes,
        sequence,
        lastRecordedHash,
        userEntryId,
      )
      pending.recordedInitial = true
      return
    }

    recordPrompt(
      ctx,
      pi,
      pending,
      'provider_request_update',
      false,
      knownPromptHashes,
      sequence,
      lastRecordedHash,
      undefined,
    )
  })

  pi.on('agent_end', () => {
    pending = undefined
    lastRecordedHash.value = undefined
  })
}
