import { describe, expect, it } from 'vitest'
import { registerSessionViewerCommand } from '../src/extension/commands'
import { createServerController } from '../src/extension/server-controller'
import type { SessionViewerPanel, ServerController } from '../src/extension/server-controller'

interface RegisteredCommand {
  handler: (args: string, context: unknown) => Promise<void>
}

interface WidgetUpdate {
  key: string
  content: string[] | undefined
  placement?: string
}

function commandContext(
  notifications: string[],
  widgets: WidgetUpdate[],
  cwd?: string,
  sessionDir = '/runtime/pi-sessions',
): unknown {
  return {
    cwd,
    sessionManager: { getSessionDir: () => sessionDir },
    ui: {
      notify: (message: string) => notifications.push(message),
      theme: {
        fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      },
      setWidget: (key: string, content: string[] | undefined, options?: { placement?: string }) => {
        widgets.push({ key, content, placement: options?.placement })
      },
    },
  }
}

function register(controller: ServerController): RegisteredCommand {
  const registrations = new Map<string, RegisteredCommand>()
  registerSessionViewerCommand({
    registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
  }, controller)
  const command = registrations.get('session-viewer')
  if (!command) throw new Error('session-viewer command was not registered')
  return command
}

describe('/session-viewer command', () => {
  it('starts on the runtime session root and shows a fixed coloured address above the editor', async () => {
    const notifications: string[] = []
    const widgets: WidgetUpdate[] = []
    const cwd = '/home/hzf/workspace/projects-dev/pi-extensions-mine/pi-session-viewer'
    const token = 'a'.repeat(43)
    let serverCwd: string | undefined
    let serverRoot: string | undefined
    const controller = createServerController({
      sessionRoot: '/tmp/pi-sessions',
      webRoot: '/tmp/pi-web',
      createToken: () => token,
      startServer: async (options) => {
        serverCwd = options.currentCwd
        serverRoot = options.sessionRoot
        return {
          host: '127.0.0.1',
          port: 43210,
          token,
          url: 'http://127.0.0.1:43210',
          close: async () => {},
        }
      },
    })

    await register(controller).handler('on', commandContext(notifications, widgets, cwd))

    expect(serverCwd).toBe(cwd)
    expect(serverRoot).toBe('/runtime/pi-sessions')
    expect(notifications).toEqual([])
    expect(widgets).toHaveLength(1)
    expect(widgets[0]).toMatchObject({ key: 'session-viewer', placement: 'aboveEditor' })
    expect(widgets[0].content?.[0]).toContain('<accent>◆ Session Viewer</accent>')
    expect(widgets[0].content?.[0]).toContain(`<warning>http://127.0.0.1:43210/#token=${token}</warning>`)
    expect(widgets[0].content?.[0]).toContain('/session-viewer hide')
  })

  it('defaults to on when called without arguments', async () => {
    const notifications: string[] = []
    const widgets: WidgetUpdate[] = []
    const panel: SessionViewerPanel = {
      host: '127.0.0.1',
      port: 43210,
      token: 'token',
      url: 'http://127.0.0.1:43210/#token=token',
    }
    let starts = 0
    const controller: ServerController = {
      start: async () => { starts += 1; return panel },
      stop: async () => {},
      getState: () => 'running',
      getPanel: () => panel,
    }
    const command = register(controller)

    await command.handler('', commandContext(notifications, widgets))
    await command.handler('   ', commandContext(notifications, widgets))

    expect(starts).toBe(2)
    expect(widgets).toHaveLength(2)
    expect(notifications).toEqual([])
  })

  it('hides and restores the address without stopping or restarting the viewer', async () => {
    const notifications: string[] = []
    const widgets: WidgetUpdate[] = []
    const panel: SessionViewerPanel = {
      host: '127.0.0.1',
      port: 43210,
      token: 'token',
      url: 'http://127.0.0.1:43210/#token=token',
    }
    let running = false
    let starts = 0
    let stops = 0
    const controller: ServerController = {
      start: async () => { starts += 1; running = true; return panel },
      stop: async () => { stops += 1; running = false },
      getState: () => running ? 'running' : 'stopped',
      getPanel: () => running ? panel : undefined,
    }
    const command = register(controller)
    const context = commandContext(notifications, widgets)

    await command.handler('on', context)
    await command.handler('hide', context)
    await command.handler('show', context)

    expect(starts).toBe(1)
    expect(stops).toBe(0)
    expect(widgets[1]).toEqual({ key: 'session-viewer', content: undefined, placement: undefined })
    expect(widgets[2].content?.[0]).toContain(panel.url)
    expect(notifications).toEqual([])

    await command.handler('off', context)

    expect(stops).toBe(1)
    expect(widgets.at(-1)).toEqual({ key: 'session-viewer', content: undefined, placement: undefined })
    expect(notifications).toEqual([])
  })

  it('does not start the server when show is requested while stopped', async () => {
    const notifications: string[] = []
    const widgets: WidgetUpdate[] = []
    let starts = 0
    const controller: ServerController = {
      start: async () => { starts += 1; throw new Error('unexpected start') },
      stop: async () => {},
      getState: () => 'stopped',
      getPanel: () => undefined,
    }

    await register(controller).handler('show', commandContext(notifications, widgets))

    expect(starts).toBe(0)
    expect(widgets).toEqual([])
    expect(notifications).toEqual(['Viewer is not running. Run /session-viewer on first.'])
  })

  it('returns usage for an unknown argument without changing server state', async () => {
    const notifications: string[] = []
    const widgets: WidgetUpdate[] = []
    let starts = 0
    let stops = 0
    const controller: ServerController = {
      start: async () => { starts += 1; throw new Error('not used') },
      stop: async () => { stops += 1 },
      getState: () => 'stopped',
      getPanel: () => undefined,
    }

    await register(controller).handler('restart', commandContext(notifications, widgets))

    expect(starts).toBe(0)
    expect(stops).toBe(0)
    expect(widgets).toEqual([])
    expect(notifications).toEqual(['Usage: /session-viewer on | off | show | hide'])
  })
})
