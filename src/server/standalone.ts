import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { configuredSessionRootSync } from './session-discovery'
import { startSessionHttpServer } from './http-server'

const host = '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '0', 10)
const token = process.env.PI_SESSION_VIEWER_TOKEN ?? randomBytes(32).toString('base64url')
const webRoot = fileURLToPath(new URL('../web/', import.meta.url))
const server = await startSessionHttpServer({
  sessionRoot: configuredSessionRootSync(),
  webRoot,
  token,
  host,
  port,
  version: '0.1.0',
  currentCwd: process.cwd(),
})

process.stdout.write(`Pi 会话分析已启动：http://${server.host}:${server.port}\n`)

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await server.close()
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
