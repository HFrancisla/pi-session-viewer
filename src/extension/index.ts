import packageManifest from '../../package.json'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fileURLToPath } from 'node:url'
import { registerSessionViewerCommand } from './commands'
import systemPromptCapture from './prompt-capture'
import { openDefaultBrowser } from './open-browser'
import { createServerController, type ServerController } from './server-controller'
import { configuredSessionRootSync } from '../server/session-discovery'

export interface ExtensionDependencies {
  controller?: ServerController
  sessionRoot?: string
  webRoot?: string
  openBrowser?: (url: string) => Promise<void> | void
}

const packageVersion = typeof packageManifest.version === 'string' ? packageManifest.version : 'unknown'

export function registerExtension(pi: ExtensionAPI, dependencies: ExtensionDependencies = {}): void {
  systemPromptCapture(pi)

  const controller = dependencies.controller ?? createServerController({
    sessionRoot: dependencies.sessionRoot ?? configuredSessionRootSync(),
    webRoot: dependencies.webRoot ?? fileURLToPath(new URL('../web/', import.meta.url)),
    version: packageVersion,
    openBrowser: dependencies.openBrowser ?? openDefaultBrowser,
  })

  registerSessionViewerCommand(pi, controller)

  let notified = false
  pi.on('session_start', (_event, ctx) => {
    if (notified) return
    notified = true
    ctx.ui.notify('Pi Session Viewer 已启用 system prompt 捕获。\n捕获内容仅保存在本地 session；卸载 package 可停止后续捕获。', 'info')
  })

  pi.on('session_shutdown', async () => {
    await controller.stop()
  })
}

export default function extension(pi: ExtensionAPI): void {
  registerExtension(pi)
}
