import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { ServerController } from './server-controller'

const SESSION_VIEWER_COMMAND = 'session-viewer'
const SESSION_VIEWER_WIDGET = 'session-viewer'
const SESSION_VIEWER_USAGE = 'Usage: /session-viewer on | off | show | hide'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function showViewerAddress(ctx: ExtensionCommandContext, url: string): void {
  const theme = ctx.ui.theme
  ctx.ui.setWidget(SESSION_VIEWER_WIDGET, [
    [
      theme.fg('accent', '◆ Session Viewer'),
      theme.fg('warning', url),
      theme.fg('muted', '· /session-viewer hide'),
    ].join('  '),
  ], { placement: 'aboveEditor' })
}

function hideViewerAddress(ctx: ExtensionCommandContext): void {
  ctx.ui.setWidget(SESSION_VIEWER_WIDGET, undefined)
}

export function registerSessionViewerCommand(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
  controller: ServerController,
): void {
  pi.registerCommand(SESSION_VIEWER_COMMAND, {
    description: 'Start, stop, show, or hide the local Pi session viewer panel address (defaults to on)',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const command = (args ?? '').trim().toLowerCase()
      if (command === 'on' || command === '') {
        try {
          const panel = await controller.start(ctx.cwd, ctx.sessionManager.getSessionDir())
          showViewerAddress(ctx, panel.url)
        } catch (error) {
          ctx.ui.notify(`Failed to start viewer: ${errorMessage(error)}`, 'error')
        }
        return
      }

      if (command === 'off') {
        try {
          await controller.stop()
          hideViewerAddress(ctx)
        } catch (error) {
          ctx.ui.notify(`Failed to stop viewer: ${errorMessage(error)}`, 'error')
        }
        return
      }

      if (command === 'hide') {
        hideViewerAddress(ctx)
        return
      }

      if (command === 'show') {
        const panel = controller.getPanel(ctx.cwd)
        if (!panel) {
          ctx.ui.notify('Viewer is not running. Run /session-viewer on first.', 'warning')
          return
        }
        showViewerAddress(ctx, panel.url)
        return
      }

      ctx.ui.notify(SESSION_VIEWER_USAGE, 'warning')
    },
  })
}
