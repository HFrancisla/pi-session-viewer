import express from 'express'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { configuredSessionRoot, listSessions, readSessionFile } from '../src/server/session-discovery'
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

app.get('/api/health', (request, response) => {
  if (rejectIfUnauthorized(request, response)) return
  response.json({ status: 'ok', version: 'dev' })
})

app.get('/api/sessions', async (request, response) => {
  if (rejectIfUnauthorized(request, response)) return
  response.json(await listSessions(sessionRoot))
})

app.get('/api/sessions/:token', async (request, response) => {
  if (rejectIfUnauthorized(request, response)) return
  try {
    response.json(await readSessionFile(sessionRoot, request.params.token))
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
