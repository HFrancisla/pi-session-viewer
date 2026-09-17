import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { ServerController } from './server-controller'

export const SESSION_VIEWER_COMMAND = 'session-viewer'
export const SESSION_VIEWER_USAGE = '用法：/session-viewer on | off'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerSessionViewerCommand(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
  controller: ServerController,
): void {
  pi.registerCommand(SESSION_VIEWER_COMMAND, {
    description: '启动或停止本地 Pi 会话分析面板',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const command = args.trim().toLowerCase()
      if (command === 'on') {
        try {
          const panel = await controller.start(ctx.cwd)
          ctx.ui.notify(`面板已启动：${panel.url}`, 'info')
        } catch (error) {
          ctx.ui.notify(`面板启动失败：${errorMessage(error)}`, 'error')
        }
        return
      }

      if (command === 'off') {
        try {
          await controller.stop()
          ctx.ui.notify('面板已关闭。', 'info')
        } catch (error) {
          ctx.ui.notify(`面板关闭失败：${errorMessage(error)}`, 'error')
        }
        return
      }

      ctx.ui.notify(SESSION_VIEWER_USAGE, 'warning')
    },
  })
}
