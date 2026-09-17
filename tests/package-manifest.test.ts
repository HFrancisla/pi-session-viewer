import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  name?: string
  private?: boolean
  keywords?: string[]
  files?: string[]
  license?: string
  repository?: { type?: string; url?: string }
  homepage?: string
  bugs?: { url?: string }
  author?: string
  publishConfig?: { access?: string }
  peerDependencies?: Record<string, string>
  engines?: { node?: string }
  pi?: { extensions?: string[]; image?: string }
  scripts?: Record<string, string>
}

async function readManifest(): Promise<PackageManifest> {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
  return JSON.parse(await readFile(packagePath, 'utf8')) as PackageManifest
}

describe('published Pi package manifest', () => {
  it('declares a public installable package with a production extension entrypoint', async () => {
    const manifest = await readManifest()

    expect(manifest.name).toBe('@hfrancisla/pi-session-viewer')
    expect(manifest.private).toBeUndefined()
    expect(manifest.license).toBe('MIT')
    expect(manifest.keywords).toEqual(expect.arrayContaining(['pi-package']))
    expect(manifest.files).toEqual(expect.arrayContaining(['dist', 'README.md', 'README.zh-CN.md', 'LICENSE']))
    expect(manifest.peerDependencies?.['@earendil-works/pi-coding-agent']).toBe('*')
    expect(manifest.engines?.node).toBe('>=20')
    expect(manifest.pi?.extensions).toEqual(['./dist/extension/index.js'])
    expect(manifest.pi?.image).toMatch(/^https:\/\/raw\.githubusercontent\.com\/hfrancisla\/pi-session-viewer\//)
    expect(manifest.repository?.url).toContain('github.com/hfrancisla/pi-session-viewer')
    expect(manifest.homepage).toContain('github.com/hfrancisla/pi-session-viewer')
    expect(manifest.bugs?.url).toContain('github.com/hfrancisla/pi-session-viewer/issues')
    expect(manifest.author).toBe('hfrancisla')
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.scripts?.verify).toBeTruthy()
    expect(manifest.scripts?.prepack).toContain('npm run test')
    expect(manifest.scripts?.prepack).toContain('npm run build')
  })
})
