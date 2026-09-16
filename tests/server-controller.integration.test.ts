import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createServerController } from '../src/extension/server-controller'

const directories: string[] = []
const controllers: Array<{ stop(): Promise<void> }> = []

afterEach(async () => {
  while (controllers.length) await controllers.pop()?.stop()
  while (directories.length) await rm(directories.pop() as string, { recursive: true, force: true })
})

describe('session viewer server integration', () => {
  it('starts one authenticated loopback server and invalidates it on stop', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-controller-'))
    directories.push(directory)
    const sessionRoot = path.join(directory, 'sessions')
    const webRoot = path.join(directory, 'web')
    await mkdir(sessionRoot, { recursive: true })
    await mkdir(webRoot, { recursive: true })
    await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>viewer</title>')
    const controller = createServerController({
      sessionRoot,
      webRoot,
      version: '0.1.0',
      openBrowser: () => { throw new Error('browser unavailable') },
    })
    controllers.push(controller)

    const panel = await controller.start()
    const response = await fetch(`${panel.url.split('/#', 1)[0]}/api/health`, {
      headers: { Authorization: `Bearer ${panel.token}` },
    })

    expect(panel.host).toBe('127.0.0.1')
    expect(panel.port).toBeGreaterThan(0)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', version: '0.1.0' })

    await controller.stop()
    await expect(fetch(`${panel.url.split('/#', 1)[0]}/api/health`, {
      headers: { Authorization: `Bearer ${panel.token}` },
    })).rejects.toThrow()
  })
})
