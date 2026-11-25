import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { createSessionRequestHandler } from '../src/server/http-server'
import { configuredSessionRoot } from '../src/server/session-discovery'

const host = '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '5174', 10)
const token = process.env.PI_SESSION_VIEWER_DEV_TOKEN ?? 'dev-token'
const sessionRoot = configuredSessionRoot()
const httpServer = createHttpServer()
const vite = await createViteServer({
  root: process.cwd(),
  server: { middlewareMode: true, hmr: { server: httpServer } },
  appType: 'spa',
})

httpServer.on('request', createSessionRequestHandler({ sessionRoot, token, version: 'dev' }, (request, response) => {
  vite.middlewares(request, response, (error?: unknown) => {
    response.statusCode = error ? 500 : 404
    response.end(error ? 'Unable to serve request.' : 'Requested resource not found.')
  })
}))

httpServer.listen(port, host, () => {
  process.stdout.write(`Pi 会话分析开发服务已启动：http://${host}:${port}
`)
  process.stdout.write(`只读会话目录：${sessionRoot}
`)
})
