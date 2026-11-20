import { createHash } from 'node:crypto'
import type { BuildSystemPromptOptions, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { CapturedToolDefinition } from '../core/types'
import { sanitizeToolForApi } from '../core/tool-provenance'
import { resolvePiVersion } from '../server/pi-runtime'

export const SYSTEM_PROMPT_ENTRY_TYPE = 'pi-session-viewer.system-prompt'

interface PendingCapture {
  messageType: 'user' | 'custom'
  /** Pi forwards a mutable options object to later before_agent_start handlers. */
  options: BuildSystemPromptOptions
  promptAtCapture: string
  recordedInitial: boolean
}

interface SerializablePromptOptions {
  customPrompt?: string
  forceSystemPrompt?: string
  selectedTools: string[]
  hiddenTools: string[]
  toolGuidelines: Record<string, string[]>
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
  sections?: Record<string, string>
}

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex')
}

function toolDefinitionsHash(tools: CapturedToolDefinition[]): string {
  const apiTools = tools.map(sanitizeToolForApi).sort((a, b) => a.name.localeCompare(b.name))
  return createHash('sha256').update(JSON.stringify(apiTools)).digest('hex')
}

function compositionFingerprint(composition: Record<string, unknown>): string {
  const { toolDefinitions: _toolDefinitions, ...metadata } = composition
  // Keep only a digest in memory; context files and custom prompts can be large.
  return createHash('sha256').update(JSON.stringify(metadata)).digest('hex')
}

function serializeOptions(options: BuildSystemPromptOptions): SerializablePromptOptions {
  return {
    customPrompt: options.customPrompt,
    forceSystemPrompt: options.forceSystemPrompt,
    hiddenTools: [...(options.hiddenTools ?? [])],
    toolGuidelines: Object.fromEntries(Object.entries(options.toolGuidelines ?? {}).map(([name, rules]) => [name, [...rules]])),
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
    sections: options.sections ? { ...options.sections } : undefined,
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
  knownCompositions: Map<string, string>,
  sequence: { value: number },
  lastRecordedHash: { value?: string; toolDefinitionsHash?: string },
  targetUserEntryId?: string,
): void {
  if (!pending) return
  const prompt = ctx.getSystemPrompt()
  const hash = promptHash(prompt)
  const options = serializeOptions(pending.options)
  const allTools = pi.getAllTools()
  const activeToolNames = pi.getActiveTools()
  const activeToolNameSet = new Set(activeToolNames)
  const hiddenToolNameSet = new Set(options.hiddenTools)
  const toolDefinitions: CapturedToolDefinition[] = allTools
    .filter((tool) => activeToolNameSet.has(tool.name) && !hiddenToolNameSet.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      promptGuidelines: tool.promptGuidelines,
      sourceInfo: tool.sourceInfo as CapturedToolDefinition['sourceInfo'],
    }))
  const definitionsHash = toolDefinitionsHash(toolDefinitions)
  const composition = { ...options, selectedTools: activeToolNames, toolDefinitions }
  const compositionHash = compositionFingerprint(composition)
  const compositionChanged = knownCompositions.get(hash) !== compositionHash
  if (!forceReference && hash === lastRecordedHash.value
    && definitionsHash === lastRecordedHash.toolDefinitionsHash && !compositionChanged) return

  const isNewSnapshot = !knownPromptHashes.has(hash)
  sequence.value += 1
  // Prompt text is deduplicated; changed inputs must still follow a reference.
  // Otherwise the viewer would incorrectly show the snapshot's old tool list,
  // hidden tools, rules, or sections after they change independently.
  const capturedComposition = isNewSnapshot || compositionChanged
    ? composition
    : { toolDefinitions }

  pi.appendEntry(SYSTEM_PROMPT_ENTRY_TYPE, {
    schemaVersion: 1,
    recordType: isNewSnapshot ? 'snapshot' : 'reference',
    captureStage,
    promptHash: hash,
    prompt: isNewSnapshot ? prompt : undefined,
    promptLength: prompt.length,
    composition: capturedComposition,
    promptBeforeFinalExtensions: isNewSnapshot && pending.promptAtCapture !== prompt ? pending.promptAtCapture : undefined,
    targetUserEntryId,
    messageType: pending.messageType,
    sequence: sequence.value,
    capturedAt: new Date().toISOString(),
    model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
    piVersion: resolvePiVersion(),
  })

  if (isNewSnapshot) knownPromptHashes.add(hash)
  knownCompositions.set(hash, compositionHash)
  lastRecordedHash.value = hash
  lastRecordedHash.toolDefinitionsHash = definitionsHash
}

export default function systemPromptCapture(pi: ExtensionAPI): void {
  const knownPromptHashes = new Set<string>()
  const knownCompositions = new Map<string, string>()
  const sequence = { value: 0 }
  const lastRecordedHash: { value?: string; toolDefinitionsHash?: string } = {}
  let pending: PendingCapture | undefined

  pi.on('session_start', (_event, ctx) => {
    knownPromptHashes.clear()
    knownCompositions.clear()
    sequence.value = 0
    pending = undefined
    lastRecordedHash.value = undefined
    lastRecordedHash.toolDefinitionsHash = undefined
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== 'custom' || entry.customType !== SYSTEM_PROMPT_ENTRY_TYPE) continue
      const data = entry.data
      if (!data || typeof data !== 'object') continue
      if ('promptHash' in data && typeof data.promptHash === 'string' && 'prompt' in data && typeof data.prompt === 'string') {
        knownPromptHashes.add(data.promptHash)
      }
      if ('promptHash' in data && typeof data.promptHash === 'string'
        && 'composition' in data && data.composition && typeof data.composition === 'object'
        && 'selectedTools' in data.composition) {
        knownCompositions.set(data.promptHash, compositionFingerprint(data.composition as Record<string, unknown>))
      }
      if ('sequence' in data && typeof data.sequence === 'number') sequence.value = Math.max(sequence.value, data.sequence)
    }
  })

  pi.on('before_agent_start', (event) => {
    pending = {
      messageType: event.messageType === 'custom' ? 'custom' : 'user',
      options: event.systemPromptOptions,
      promptAtCapture: event.systemPrompt,
      recordedInitial: false,
    }
  })

  pi.on('before_provider_request', (_event, ctx) => {
    if (!pending) return

    if (!pending.recordedInitial) {
      const userEntryId = pending.messageType === 'user'
        ? latestUserEntryId(ctx.sessionManager.getBranch())
        : undefined
      recordPrompt(
        ctx,
        pi,
        pending,
        'agent_start',
        true,
        knownPromptHashes,
        knownCompositions,
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
      knownCompositions,
      sequence,
      lastRecordedHash,
      undefined,
    )
  })

  pi.on('agent_end', () => {
    pending = undefined
    lastRecordedHash.value = undefined
    lastRecordedHash.toolDefinitionsHash = undefined
  })
}
