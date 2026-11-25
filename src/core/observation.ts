import type { RawObject, ToolSourceInfo } from './types'

export const OBSERVATION_TYPE = 'pi-session-viewer.observation'

export interface SupplementalObservation {
  schemaVersion: 1
  piVersion: string
  anchorEntryId: string
  assistantEntryId: string
  forcedPrompt?: string
  toolSources?: Array<{ name: string; sourceInfo: ToolSourceInfo | null }>
}

function object(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isViewerRecord(raw: RawObject): boolean {
  return raw.type === 'custom' && raw.customType === OBSERVATION_TYPE
}

export function readObservation(raw: RawObject): SupplementalObservation | undefined {
  if (raw.type !== 'custom' || raw.customType !== OBSERVATION_TYPE || !object(raw.data)) return
  const data = raw.data
  if (data.schemaVersion !== 1 || typeof data.piVersion !== 'string' || !data.piVersion
    || typeof data.anchorEntryId !== 'string' || typeof data.assistantEntryId !== 'string') return
  if (data.forcedPrompt !== undefined && typeof data.forcedPrompt !== 'string') return
  if (data.toolSources !== undefined && (!Array.isArray(data.toolSources)
    || data.toolSources.some(item => !object(item) || typeof item.name !== 'string'
      || (item.sourceInfo !== null && !object(item.sourceInfo))))) return
  return data as unknown as SupplementalObservation
}
