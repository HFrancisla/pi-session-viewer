// Shared core formatting helpers.
export function formatClock(timestamp?: string): string {
  if (!timestamp) return '时间未知'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatDateTime(timestamp?: string): string {
  if (!timestamp) return '未知时间'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatDuration(milliseconds?: number): string {
  if (milliseconds == null || milliseconds < 0 || !Number.isFinite(milliseconds)) return '未记录'
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} 秒`
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.round((milliseconds % 60_000) / 1000)
  return `${minutes} 分 ${seconds} 秒`
}

export function truncate(value: string, max = 92): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return '无文本内容'
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}
