import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { ServerController } from './server-controller'

export const SESSION_VIEWER_COMMAND = 'session-viewer'
export const SESSION_VIEWER_USAGE = 'Usage: /session-viewer on | off'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerSessionViewerCommand(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
  controller: ServerController,
): void {
  pi.registerCommand(SESSION_VIEWER_COMMAND, {
    description: 'Start or stop the local Pi session viewer panel (defaults to on)',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const command = (args ?? '').trim().toLowerCase()
      if (command === 'on' || command === '') {
        try {
          const panel = await controller.start(ctx.cwd)
          ctx.ui.notify(`Viewer started at: ${panel.url}`, 'info')
        } catch (error) {
          ctx.ui.notify(`Failed to start viewer: ${errorMessage(error)}`, 'error')
        }
        return
      }

      if (command === 'off') {
        try {
          await controller.stop()
          ctx.ui.notify('Viewer stopped.', 'info')
        } catch (error) {
          ctx.ui.notify(`Failed to stop viewer: ${errorMessage(error)}`, 'error')
        }
        return
      }

      ctx.ui.notify(SESSION_VIEWER_USAGE, 'warning')
    },
  })
}
