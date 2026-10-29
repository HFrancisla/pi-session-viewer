import { createServer, type Server } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promises as fs } from 'node:fs'
import { hasValidBearerToken, isAllowedHost, isAllowedOrigin } from './security'
import { listSessions, resolveAllowedSessionFile, resolveSessionTarget } from './session-discovery'
import { computeContextProjections } from './context-projection'
import { readStaticAsset } from './static-assets'
import { createLruCache, type LruCache } from '../core/lru-cache'

export interface SessionHttpServerOptions {
  sessionRoot: string
  webRoot: string
  token: string
  host?: string
  port?: number
  version?: string
  currentCwd?: string
}

export interface SessionHttpServer {
  readonly host: string
  readonly port: number
  readonly token: string
  readonly url: string
  close(): Promise<void>
}

const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

/**
 * Serialized session payloads, keyed by file identity (path, mtime, size).
 *
 * Answering a session request means reading the file, projecting every branch
 * through Pi, and serializing a body that can run to megabytes — all inside the
 * Pi process. Switching between sessions is the viewer's main gesture, so the
 * last few bodies are kept; a changed file changes its key and refetches.
 *
 * The weight of one body is its character count, a proxy for the bytes it costs.
 */
const SESSION_BODY_CACHE_WEIGHT = 64 * 1024 * 1024
type SessionBodyCache = LruCache<string>

function sendCachedJson(response: ServerResponse, body: string): void {
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(body)
}

async function sendSessionPayload(
  response: ServerResponse,
  sessionBodies: SessionBodyCache,
  absolute: string,
  relative: string,
  token: string,
): Promise<void> {
  const stat = await fs.stat(absolute)
  const cacheKey = `${relative}\u0000${stat.mtimeMs}\u0000${stat.size}`
  const cached = sessionBodies.get(cacheKey)
  if (cached !== undefined) {
    sendCachedJson(response, cached)
    return
  }
  const content = await fs.readFile(absolute, 'utf8')
  // What the model actually received is computed by Pi itself; when Pi is not
  // reachable the field stays absent and the UI shows no marks.
  const contextProjections = await computeContextProjections(content, relative)
  const payload = {
    token,
    relativePath: relative,
    modifiedAt: stat.mtime.toISOString(),
    content,
    ...(contextProjections ? { contextProjections } : {}),
  }
  const body = JSON.stringify(payload)
  sessionBodies.set(cacheKey, body)
  sendCachedJson(response, body)
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: SessionHttpServerOptions,
  sessionBodies: SessionBodyCache,
): Promise<void> {
  setSecurityHeaders(response)

  if (!isAllowedHost(request.headers.host)) {
    sendJson(response, 403, { error: 'Only local loopback access is allowed.' })
    return
  }

  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: 'Cross-origin request rejected.' })
    return
  }

  const pathname = (request.url ?? '/').split('?', 1)[0] || '/'

  if (pathname.startsWith('/api/') && !hasValidBearerToken(request, options.token)) {
    sendJson(response, 401, { error: 'Valid access token required.' })
    return
  }

  if (pathname.startsWith('/api/') && request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    sendJson(response, 405, { error: 'Only read-only GET requests are supported.' })
    return
  }

  if (pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok', version: options.version ?? 'unknown' })
    return
  }

  if (pathname === '/api/sessions') {
    sendJson(response, 200, await listSessions(options.sessionRoot, options.currentCwd))
    return
  }

  if (pathname === '/api/resolve') {
    const searchParams = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams
    const target = searchParams.get('target')
    const parent = searchParams.get('parent') ?? undefined
    if (!target) {
      sendJson(response, 400, { error: 'Target session identifier is required.' })
      return
    }

    try {
      const result = await resolveSessionTarget(options.sessionRoot, target, parent)
      if (result.kind === 'transcript-only') {
        sendJson(response, 422, {
          error: 'Subagent transcript is not a runnable session.',
          code: 'subagent-transcript-only',
        })
        return
      }
      if (result.kind === 'not-found') {
        sendJson(response, 404, { error: `No session file found for ${target}` })
        return
      }
      await sendSessionPayload(response, sessionBodies, result.absolute, result.relative, result.token)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 500, { error: message })
    }
    return
  }

  const sessionPathPrefix = '/api/sessions/'
  if (pathname.startsWith(sessionPathPrefix)) {
    let token: string
    try {
      token = decodeURIComponent(pathname.slice(sessionPathPrefix.length))
    } catch {
      sendJson(response, 400, { error: 'Invalid session file identifier.' })
      return
    }
    try {
      const { absolute, relative } = await resolveAllowedSessionFile(options.sessionRoot, token)
      await sendSessionPayload(response, sessionBodies, absolute, relative, token)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 404, { error: message })
    }
    return
  }

  if (request.method === 'GET') {
    const asset = await readStaticAsset(options.webRoot, pathname)
    if (asset) {
      response.statusCode = 200
      response.setHeader('Content-Type', asset.contentType)
      response.setHeader('Cache-Control', asset.cacheControl)
      response.end(asset.body)
      return
    }
  }

  sendJson(response, 404, { error: 'Requested resource not found.' })
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address() as AddressInfo
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

export async function startSessionHttpServer(options: SessionHttpServerOptions): Promise<SessionHttpServer> {
  const host = options.host ?? '127.0.0.1'
  const sessionBodies = createLruCache<string>({
    maxEntries: 8,
    maxWeight: SESSION_BODY_CACHE_WEIGHT,
    weigh: (body) => body.length,
  })
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, options, sessionBodies)
  })
  const port = await listen(httpServer, host, options.port ?? 0)
  return {
    host,
    port,
    token: options.token,
    url: `http://${host}:${port}`,
    close: () => close(httpServer),
  }
}
