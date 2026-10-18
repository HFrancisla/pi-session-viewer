export function piSessionHeader(
  id: string,
  timestamp: string,
  cwd: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'session',
    version: 3,
    id,
    timestamp,
    cwd,
    ...extra,
  })
}
