import { describe, expect, it } from 'vitest'
import { registerSessionViewerCommand } from '../src/extension/commands'
import type { SessionViewerPanel, ServerController } from '../src/extension/server-controller'

interface RegisteredCommand {
  handler: (args: string, context: unknown) => Promise<void>
}

function commandContext(notifications: string[]): unknown {
  return {
    ui: {
      notify: (message: string) => notifications.push(message),
    },
  }
}

describe('/session-viewer command', () => {
  it('starts the panel and explains that capture remains enabled', async () => {
    const registrations = new Map<string, RegisteredCommand>()
    const notifications: string[] = []
    const panel: SessionViewerPanel = {
      host: '127.0.0.1',
      port: 43210,
      token: 'a'.repeat(64),
      url: 'http://127.0.0.1:43210/#token=' + 'a'.repeat(64),
    }
    const controller: ServerController = {
      start: async () => panel,
      stop: async () => {},
      getState: () => 'stopped',
    }
    registerSessionViewerCommand({
      registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
    }, controller)

    await registrations.get('session-viewer')?.handler('on', commandContext(notifications))

    expect(notifications).toEqual(['面板已启动：http://127.0.0.1:43210/#token=' + 'a'.repeat(64) + '\nSystem prompt 捕获始终开启。'])
  })

  it('stops only the panel and explains that capture continues', async () => {
    const registrations = new Map<string, RegisteredCommand>()
    const notifications: string[] = []
    let stopCount = 0
    const controller: ServerController = {
      start: async () => { throw new Error('not used') },
      stop: async () => { stopCount += 1 },
      getState: () => 'running',
    }
    registerSessionViewerCommand({
      registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
    }, controller)

    await registrations.get('session-viewer')?.handler('off', commandContext(notifications))

    expect(stopCount).toBe(1)
    expect(notifications).toEqual(['面板已关闭。\nSystem prompt 捕获仍在继续；卸载 package 才会停止捕获。'])
  })

  it('returns usage for an unknown argument without changing server state', async () => {
    const registrations = new Map<string, RegisteredCommand>()
    const notifications: string[] = []
    let starts = 0
    let stops = 0
    const controller: ServerController = {
      start: async () => { starts += 1; throw new Error('not used') },
      stop: async () => { stops += 1 },
      getState: () => 'stopped',
    }
    registerSessionViewerCommand({
      registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
    }, controller)

    await registrations.get('session-viewer')?.handler('restart', commandContext(notifications))

    expect(starts).toBe(0)
    expect(stops).toBe(0)
    expect(notifications).toEqual(['用法：/session-viewer on | off'])
  })
})
