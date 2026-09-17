import { access, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

describe('production build artifacts', () => {
  it('builds the extension entrypoint and self-contained web assets under dist', async () => {
    await run('npm', ['run', 'build'], { cwd: projectRoot })

    await expect(access(path.join(projectRoot, 'dist/extension/index.js'))).resolves.toBeUndefined()
    await expect(access(path.join(projectRoot, 'dist/standalone/index.js'))).resolves.toBeUndefined()
    await expect(access(path.join(projectRoot, 'dist/web/index.html'))).resolves.toBeUndefined()
    await expect(access(path.join(projectRoot, 'dist/web/favicon.svg'))).resolves.toBeUndefined()
    const extensionBundle = await readFile(path.join(projectRoot, 'dist/extension/index.js'), 'utf8')
    expect(extensionBundle).not.toMatch(/(?:from|require\()\s*["']vite["']/)
    expect(extensionBundle).not.toContain('createViteServer')
    expect(extensionBundle).not.toContain('/home/hzf/workspace/projects-mine/pi-session-viewer/src/')
  })
})
