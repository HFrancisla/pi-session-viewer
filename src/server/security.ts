import type { IncomingMessage } from 'node:http'

function hostnameFromHeader(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('[')) {
    const closingBracket = normalized.indexOf(']')
    return closingBracket > 0 ? normalized.slice(1, closingBracket) : undefined
  }
  return normalized.split(':', 1)[0]
}

export function isAllowedHost(value: string | undefined): boolean {
  const hostname = hostnameFromHeader(value)
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

export function isAllowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (!origin) return true

  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:'
      && isAllowedHost(parsed.host)
      && parsed.host.toLowerCase() === request.headers.host?.toLowerCase()
  } catch {
    return false
  }
}

export function hasValidBearerToken(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization
  return authorization === `Bearer ${expectedToken}`
}
