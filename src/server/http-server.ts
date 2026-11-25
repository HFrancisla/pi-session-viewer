import { createServer, type Server } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promises as fs } from 'node:fs'
import { hasValidBearerToken, isAllowedHost, isAllowedOrigin } from './security'
import { discoverSessionCatalog, resolveAllowedSessionFile, resolveSessionTarget } from './session-discovery'
import { computeContextProjections } from './context-projection'
import { readStaticAsset } from './static-assets'
import { createLruCache, type LruCache } from '../core/lru-cache'

interface SessionRequestOptions {
  sessionRoot: string
  token: string
  version?: string
  currentCwd?: string
}

export interface SessionHttpServerOptions extends SessionRequestOptions {
  webRoot: string
  host?: string
  port?: number
}

type WebHandler = (request: IncomingMessage, response: ServerResponse, pathname: string) => void | Promise<void>

export interface SessionHttpServer {
  readonly host: string
  readonly port: number
  readonly token: string
  readonly url: string
  close(): Promise<void>
}

const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
}

function sendJsonBody(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(body)
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  sendJsonBody(response, statusCode, JSON.stringify(body))
}

/**
 * Serialized session payloads, keyed by file identity and requested session token.
 *
 * Answering a session request means reading the file, projecting selected branches
 * through Pi, and serializing a body that can run to megabytes — all inside the
 * Pi process. Switching between sessions is the viewer's main gesture, so the
 * last few bodies are kept; a changed file changes its key and refetches.
 *
 * The weight of one body is its character count, a proxy for the bytes it costs.
 */
const SESSION_BODY_CACHE_WEIGHT = 64 * 1024 * 1024
type SessionBodyCache = LruCache<string>

async function sendSessionPayload(
  response: ServerResponse,
  sessionBodies: SessionBodyCache,
  absolute: string,
  relative: string,
  token: string,
): Promise<void> {
  const stat = await fs.stat(absolute)
  const cacheKey = `${absolute}\u0000${token}\u0000${stat.dev}\u0000${stat.ino}\u0000${stat.ctimeMs}\u0000${stat.mtimeMs}\u0000${stat.size}`
  const cached = sessionBodies.get(cacheKey)
  if (cached !== undefined) {
    sendJsonBody(response, 200, cached)
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
  sendJsonBody(response, 200, body)
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: SessionRequestOptions,
  sessionBodies: SessionBodyCache,
  serveWeb: WebHandler,
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
    sendJson(response, 200, await discoverSessionCatalog(options.sessionRoot, options.currentCwd))
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

  if (pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'Requested resource not found.' })
    return
  }

  await serveWeb(request, response, pathname)
}

/** One request pipeline for the packaged server and the Vite dev server. */
export function createSessionRequestHandler(options: SessionRequestOptions, serveWeb: WebHandler) {
  const sessionBodies = createLruCache<string>({
    maxEntries: 8,
    maxWeight: SESSION_BODY_CACHE_WEIGHT,
    weigh: (body) => body.length,
  })
  return (request: IncomingMessage, response: ServerResponse) => {
    void handleRequest(request, response, options, sessionBodies, serveWeb).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'Unable to serve request.' })
      else response.destroy()
    })
  }
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
  const handle = createSessionRequestHandler(options, async (request, response, pathname) => {
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
  })
  const httpServer = createServer((request, response) => {
    response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    handle(request, response)
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
