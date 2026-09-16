import type { EventKind } from './types'

export const allEventKinds: EventKind[] = [
  'system-prompt',
  'user',
  'assistant',
  'thinking',
  'tool-call',
  'tool-result',
  'system',
]
