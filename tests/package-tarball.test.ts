import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

describe('npm package tarball', () => {
  it('contains only the public manifest, docs, license, and production dist', async () => {
    await run('npm', ['run', 'build'], { cwd: projectRoot })
    const result = await run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: projectRoot })
    const report = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>
    const files = report[0]?.files.map((file) => file.path) ?? []

    expect(files).toContain('package.json')
    expect(files).toContain('README.md')
    expect(files).toContain('LICENSE')
    expect(files).toContain('dist/extension/index.js')
    expect(files).toContain('dist/standalone/index.js')
    expect(files).toContain('dist/web/index.html')
    expect(files.every((file) => file === 'package.json' || file === 'README.md' || file === 'LICENSE' || file.startsWith('dist/'))).toBe(true)
  }, 30_000)
})
