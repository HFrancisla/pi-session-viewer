import { describe, expect, it } from 'vitest'
import extension, { registerExtension } from '../src/extension/index'

describe('Pi package extension entrypoint', () => {
  it('registers capture hooks, the panel command, and shutdown cleanup on load', () => {
    const events: string[] = []
    const commands: string[] = []
    const pi = {
      on: (event: string) => { events.push(event) },
      registerCommand: (name: string) => { commands.push(name) },
    }

    extension(pi as never)

    expect(events).toEqual(expect.arrayContaining([
      'session_start',
      'before_agent_start',
      'agent_start',
      'before_provider_request',
      'agent_end',
      'session_shutdown',
    ]))
    expect(commands).toEqual(['session-viewer'])
  })

  it('closes the panel controller when Pi emits session_shutdown', async () => {
    const handlers = new Map<string, (event: unknown, context: any) => unknown>()
    let stopCount = 0
    const pi = {
      on: (event: string, handler: (event: unknown, context: any) => unknown) => { handlers.set(event, handler) },
      registerCommand: () => {},
    }

    registerExtension(pi as never, {
      controller: {
        start: async () => ({ host: '127.0.0.1', port: 1, token: 'x', url: 'http://127.0.0.1:1/#token=x' }),
        stop: async () => { stopCount += 1 },
        getState: () => 'running',
      },
    })
    await handlers.get('session_shutdown')?.({}, {})

    expect(stopCount).toBe(1)
  })
})
