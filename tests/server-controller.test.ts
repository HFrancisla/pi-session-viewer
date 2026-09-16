import { describe, expect, it } from 'vitest'
import { createServerController } from '../src/extension/server-controller'
import type { SessionHttpServer } from '../src/server/http-server'

describe('session viewer server controller', () => {
  it('shares one in-flight start and reuses the same running panel', async () => {
    let startCount = 0
    const fakeServer: SessionHttpServer = {
      host: '127.0.0.1',
      port: 43123,
      token: 'f'.repeat(64),
      url: 'http://127.0.0.1:43123',
      close: async () => {},
    }
    const controller = createServerController({
      sessionRoot: '/tmp/pi-sessions',
      webRoot: '/tmp/pi-web',
      version: '0.1.0',
      createToken: () => 'f'.repeat(64),
      startServer: async () => {
        startCount += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return fakeServer
      },
    })

    const [first, second] = await Promise.all([controller.start(), controller.start()])

    expect(startCount).toBe(1)
    expect(first).toBe(second)
    expect(first.url).toBe('http://127.0.0.1:43123/#token=' + 'f'.repeat(64))
  })

  it('closes the running listener once and makes repeated stops harmless', async () => {
    let closeCount = 0
    const fakeServer: SessionHttpServer = {
      host: '127.0.0.1',
      port: 43124,
      token: '1'.repeat(64),
      url: 'http://127.0.0.1:43124',
      close: async () => { closeCount += 1 },
    }
    const controller = createServerController({
      sessionRoot: '/tmp/pi-sessions',
      webRoot: '/tmp/pi-web',
      startServer: async () => fakeServer,
    })

    await controller.start()
    await Promise.all([controller.stop(), controller.stop(), controller.stop()])

    expect(closeCount).toBe(1)
    expect(controller.getState()).toBe('stopped')
    await expect(controller.stop()).resolves.toBeUndefined()
  })

  it('creates a fresh 256-bit access token for each server instance', async () => {
    const tokens: string[] = []
    const controller = createServerController({
      sessionRoot: '/tmp/pi-sessions',
      webRoot: '/tmp/pi-web',
      startServer: async (options) => {
        tokens.push(options.token)
        return {
          host: '127.0.0.1',
          port: 43125,
          token: options.token,
          url: 'http://127.0.0.1:43125',
          close: async () => {},
        }
      },
    })

    await controller.start()
    await controller.stop()
    await controller.start()

    expect(tokens[0]).toHaveLength(43)
    expect(tokens[1]).toHaveLength(43)
    expect(tokens[0]).not.toBe(tokens[1])
  })

  it('returns to stopped after a failed start so a later start can recover', async () => {
    let attempts = 0
    const controller = createServerController({
      sessionRoot: '/tmp/pi-sessions',
      webRoot: '/tmp/pi-web',
      startServer: async (options) => {
        attempts += 1
        if (attempts === 1) throw new Error('port unavailable')
        return {
          host: '127.0.0.1',
          port: 43126,
          token: options.token,
          url: 'http://127.0.0.1:43126',
          close: async () => {},
        }
      },
    })

    await expect(controller.start()).rejects.toThrow('port unavailable')
    expect(controller.getState()).toBe('stopped')
    await expect(controller.start()).resolves.toMatchObject({ port: 43126 })
    expect(attempts).toBe(2)
  })
})
