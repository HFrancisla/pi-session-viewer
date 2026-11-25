import { PI_PROMPT_BASELINE_VERSION } from './pi-defaults'
import type { RawObject } from './types'

export const SYSTEM_PROMPT_ENTRY_TYPE = 'pi-session-viewer.system-prompt'

function isObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPromptCaptureEntry(entry: unknown): entry is RawObject & { type: 'custom'; customType: typeof SYSTEM_PROMPT_ENTRY_TYPE } {
  return isObject(entry) && entry.type === 'custom' && entry.customType === SYSTEM_PROMPT_ENTRY_TYPE
}

export function isCurrentPromptVersion(version: unknown): boolean {
  return version === PI_PROMPT_BASELINE_VERSION
}

/** Only explicitly versioned captures belonging to the verified Pi contract are admitted. */
export function readCurrentPromptCapture(entry: unknown): RawObject | undefined {
  if (!isPromptCaptureEntry(entry) || !isObject(entry.data)) return undefined
  return isCurrentPromptVersion(entry.data.piVersion) ? entry.data : undefined
}
