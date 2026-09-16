import { randomBytes } from 'node:crypto'
import { startSessionHttpServer, type SessionHttpServer, type SessionHttpServerOptions } from '../server/http-server'

export type ServerControllerState = 'stopped' | 'starting' | 'running' | 'stopping'

export interface SessionViewerPanel {
  readonly host: string
  readonly port: number
  readonly token: string
  readonly url: string
}

export interface ServerControllerOptions {
  sessionRoot: string
  webRoot: string
  version?: string
  host?: string
  port?: number
  startServer?: (options: SessionHttpServerOptions) => Promise<SessionHttpServer>
  createToken?: () => string
  openBrowser?: (url: string) => Promise<void> | void
}

export interface ServerController {
  start(): Promise<SessionViewerPanel>
  stop(): Promise<void>
  getState(): ServerControllerState
}

function defaultToken(): string {
  return randomBytes(32).toString('base64url')
}

function panelFromServer(server: SessionHttpServer): SessionViewerPanel {
  return {
    host: server.host,
    port: server.port,
    token: server.token,
    url: `${server.url}/#token=${encodeURIComponent(server.token)}`,
  }
}

export function createServerController(options: ServerControllerOptions): ServerController {
  const startServer = options.startServer ?? startSessionHttpServer
  const createToken = options.createToken ?? defaultToken
  let state: ServerControllerState = 'stopped'
  let server: SessionHttpServer | undefined
  let panel: SessionViewerPanel | undefined
  let startPromise: Promise<SessionViewerPanel> | undefined
  let stopPromise: Promise<void> | undefined

  const stopRunningServer = async (): Promise<void> => {
    const activeServer = server
    server = undefined
    panel = undefined
    if (!activeServer) return
    await activeServer.close()
  }

  const start = async (): Promise<SessionViewerPanel> => {
    if (panel && state === 'running') return panel
    if (startPromise) return startPromise
    if (stopPromise) await stopPromise

    state = 'starting'
    startPromise = (async () => {
      try {
        const started = await startServer({
          sessionRoot: options.sessionRoot,
          webRoot: options.webRoot,
          token: createToken(),
          host: options.host,
          port: options.port,
          version: options.version,
        })
        server = started
        panel = panelFromServer(started)
        state = 'running'
        if (options.openBrowser) {
          try {
            await options.openBrowser(panel.url)
          } catch {
            // Opening a browser is best effort; the URL remains available to copy.
          }
        }
        return panel
      } catch (error) {
        state = 'stopped'
        throw error
      } finally {
        startPromise = undefined
      }
    })()
    return startPromise
  }

  const stop = async (): Promise<void> => {
    if (stopPromise) return stopPromise
    if (startPromise) {
      try {
        await startPromise
      } catch {
        return
      }
    }
    if (!server) {
      state = 'stopped'
      return
    }
    state = 'stopping'
    stopPromise = stopRunningServer().finally(() => {
      state = 'stopped'
      stopPromise = undefined
    })
    return stopPromise
  }

  return {
    start,
    stop,
    getState: () => state,
  }
}
