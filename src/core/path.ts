// Pure path helpers shared across environments (Node.js and browser).
export function normalizePath(cwd?: string | null): string {
  if (!cwd) return ''
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '')
}
