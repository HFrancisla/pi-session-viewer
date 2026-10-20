import type { EventKind } from './types'

export const allEventKinds: EventKind[] = [
  'system-prompt',
  'tool-definitions',
  'user',
  'assistant',
  'thinking',
  'tool-call',
  'tool-result',
  'system',
]

/**
 * The filters a fresh viewer starts with. Pi's `system` entries (model switches,
 * context edits, usage rows) are incidental bookkeeping, so they stay hidden
 * until the reader opts into them; the conversation is what opens first.
 */
export const defaultEventKinds: EventKind[] = allEventKinds.filter((kind) => kind !== 'system')
