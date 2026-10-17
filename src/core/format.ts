// Shared core formatting helpers.
const clockFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export function formatClock(timestamp?: string): string {
  if (!timestamp) return 'Unknown time'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return clockFormatter.format(date)
}

export function formatDateTime(timestamp?: string): string {
  if (!timestamp) return 'Unknown date'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatDuration(milliseconds?: number): string {
  if (milliseconds == null || milliseconds < 0 || !Number.isFinite(milliseconds)) return 'Unrecorded'
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.round((milliseconds % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

const WHITESPACE = /\s/

/**
 * The leading part of `value.replace(/\s+/g, ' ').trim()` needed to decide the
 * result, read as a stream.
 *
 * Normalizing the whole string cost O(content) on multi-megabyte tool output even
 * though only `max` characters are kept, and the timeline builds summaries on
 * every view. Reading stops one character past `max`: that is enough to know
 * whether the ellipsis is needed. A whitespace run is only materialized when
 * something follows it, which is what `trim()` did at the end.
 */
function compactPrefix(value: string, max: number): string {
  const length = value.length
  let index = 0
  while (index < length && WHITESPACE.test(value[index])) index += 1

  let compact = ''
  while (index < length) {
    if (WHITESPACE.test(value[index])) {
      while (index < length && WHITESPACE.test(value[index])) index += 1
      if (index < length) compact += ' '
    } else {
      compact += value[index]
      index += 1
    }
    if (compact.length > max) return compact
  }
  return compact
}

export function truncate(value: string, max = 92): string {
  const compact = compactPrefix(value, max)
  if (!compact) return 'No text content'
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}
