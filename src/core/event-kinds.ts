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
