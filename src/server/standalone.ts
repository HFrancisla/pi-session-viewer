import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import packageManifest from '../../package.json'
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
  version: typeof packageManifest.version === 'string' ? packageManifest.version : '0.2.0',
  currentCwd: process.cwd(),
})

process.stdout.write(`Pi session viewer started at: http://${server.host}:${server.port}\n`)

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await server.close()
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
