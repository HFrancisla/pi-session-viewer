import { createServer, type Server } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { hasValidBearerToken, isAllowedHost, isAllowedOrigin } from './security'
import { listSessions, readSessionFile } from './session-discovery'
import { readStaticAsset } from './static-assets'

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

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: SessionHttpServerOptions,
): Promise<void> {
  setSecurityHeaders(response)

  if (!isAllowedHost(request.headers.host)) {
    sendJson(response, 403, { error: '只允许通过本机地址访问。' })
    return
  }

  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: '拒绝跨源访问。' })
    return
  }

  const pathname = (request.url ?? '/').split('?', 1)[0] || '/'

  if (pathname.startsWith('/api/') && !hasValidBearerToken(request, options.token)) {
    sendJson(response, 401, { error: '需要有效的访问令牌。' })
    return
  }

  if (pathname.startsWith('/api/') && request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    sendJson(response, 405, { error: '只支持只读 GET 请求。' })
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

  const sessionPathPrefix = '/api/sessions/'
  if (pathname.startsWith(sessionPathPrefix)) {
    let token: string
    try {
      token = decodeURIComponent(pathname.slice(sessionPathPrefix.length))
    } catch {
      sendJson(response, 400, { error: '无效的会话文件标识。' })
      return
    }
    try {
      sendJson(response, 200, await readSessionFile(options.sessionRoot, token))
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

  sendJson(response, 404, { error: '未找到请求的资源。' })
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
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, options)
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
