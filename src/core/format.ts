// Shared core formatting helpers.
export function formatClock(timestamp?: string): string {
  if (!timestamp) return 'Unknown time'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
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

export function truncate(value: string, max = 92): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return 'No text content'
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}
