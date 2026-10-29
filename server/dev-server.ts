import express from 'express'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { computeContextProjections } from '../src/server/context-projection'
import { configuredSessionRoot, listSessions, readSessionFile, resolveSessionTarget } from '../src/server/session-discovery'
import { hasValidBearerToken, isAllowedHost, isAllowedOrigin } from '../src/server/security'

const host = '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '5174', 10)
const accessToken = process.env.PI_SESSION_VIEWER_DEV_TOKEN ?? 'dev-token'
const sessionRoot = await configuredSessionRoot()
const app = express()
app.disable('x-powered-by')

function rejectIfUnauthorized(request: express.Request, response: express.Response): boolean {
  if (!isAllowedHost(request.headers.host)) {
    response.status(403).json({ error: '只允许通过本机地址访问。' })
    return true
  }
  if (!isAllowedOrigin(request)) {
    response.status(403).json({ error: '拒绝跨源访问。' })
    return true
  }
  if (!hasValidBearerToken(request, accessToken)) {
    response.status(401).json({ error: '需要有效的访问令牌。' })
    return true
  }
  response.setHeader('Cache-Control', 'no-store')
  return false
}

async function readSessionPayload(token: string) {
  const sessionFile = await readSessionFile(sessionRoot, token)
  // Mirrors the production server: the context projection comes from Pi itself.
  const contextProjections = await computeContextProjections(sessionFile.content, sessionFile.relativePath)
  return contextProjections ? { ...sessionFile, contextProjections } : sessionFile
}

app.get('/api/health', (request, response) => {
  if (rejectIfUnauthorized(request, response)) return
  response.json({ status: 'ok', version: 'dev' })
})

app.get('/api/sessions', async (request, response) => {
  if (rejectIfUnauthorized(request, response)) return
  response.json(await listSessions(sessionRoot))
})

app.get('/api/resolve', async (request, response) => {
  if (rejectIfUnauthorized(request, response)) return
  const target = typeof request.query.target === 'string' ? request.query.target : ''
  const parent = typeof request.query.parent === 'string' ? request.query.parent : undefined
  if (!target) {
    response.status(400).json({ error: 'Target session identifier is required.' })
    return
  }

  try {
    const result = await resolveSessionTarget(sessionRoot, target, parent)
    if (result.kind === 'transcript-only') {
      response.status(422).json({
        error: 'Subagent transcript is not a runnable session.',
        code: 'subagent-transcript-only',
      })
      return
    }
    if (result.kind === 'not-found') {
      response.status(404).json({ error: `No session file found for ${target}` })
      return
    }
    response.json(await readSessionPayload(result.token))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    response.status(500).json({ error: message })
  }
})

app.get('/api/sessions/:token', async (request, response) => {
  if (rejectIfUnauthorized(request, response)) return
  try {
    response.json(await readSessionPayload(request.params.token))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    response.status(404).json({ error: message })
  }
})

const httpServer = createHttpServer(app)
const vite = await createViteServer({
  root: process.cwd(),
  server: { middlewareMode: true, hmr: { server: httpServer } },
  appType: 'spa',
})
app.use(vite.middlewares)

httpServer.listen(port, host, () => {
  process.stdout.write(`Pi 会话分析开发服务已启动：http://${host}:${port}\n`)
  process.stdout.write(`只读会话目录：${sessionRoot}\n`)
})
