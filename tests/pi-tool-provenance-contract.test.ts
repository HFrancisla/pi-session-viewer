import { describe, expect, it } from 'vitest'
import { resolveToolProvenance, syntheticPathSource } from '../src/core/tool-provenance'
import type { CapturedToolDefinition } from '../src/core/types'
import { importPiInternal, PI_VERSION } from './helpers/pi-runtime'

/**
 * Provenance contract.
 *
 * The viewer labels each tool by reading Pi's `sourceInfo`. These tests build
 * those values with Pi's own helpers (`createSyntheticSourceInfo`,
 * `BUILTIN_PATH_PREFIX`, `getSyntheticPathSource`), so the expectations come from
 * Pi rather than from a hand-written guess about its path format.
 */
interface SourceInfoModule {
  BUILTIN_PATH_PREFIX: string
  createSyntheticSourceInfo(
    path: string,
    options: { source: string; scope?: string; origin?: string; baseDir?: string }
  ): Record<string, unknown>
  getSyntheticPathSource(path: string): string | undefined
  isSyntheticPath(path: string): boolean
}

const sourceInfoModule = await importPiInternal<SourceInfoModule>('dist/core/source-info.js')

function toolWithSourceInfo(name: string, sourceInfo: Record<string, unknown>): CapturedToolDefinition {
  return { name, sourceInfo }
}

describe(`Pi contract: tool sourceInfo shapes from Pi ${PI_VERSION}`, () => {
  it("uses Pi's own prefix for built-in tool paths", () => {
    // Guards the assumption the viewer relies on; if Pi renames the prefix this
    // fails instead of mislabelling every built-in tool.
    expect(sourceInfoModule.BUILTIN_PATH_PREFIX).toBe('builtin:')
  })

  it('classifies every built-in tool path Pi can produce as built-in', () => {
    for (const name of ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'powershell']) {
      const sourceInfo = sourceInfoModule.createSyntheticSourceInfo(
        `${sourceInfoModule.BUILTIN_PATH_PREFIX}${name}`,
        { source: 'builtin' }
      )
      const resolved = resolveToolProvenance(toolWithSourceInfo(name, sourceInfo))

      expect(resolved.kind, `tool ${name} (${JSON.stringify(sourceInfo)})`).toBe('builtin')
      expect(resolved.isBuiltin).toBe(true)
      expect(resolved.rawPath).toBe(sourceInfo.path)
    }
  })

  it('recognizes a built-in path even when Pi omits the source field', () => {
    const sourceInfo = { path: `${sourceInfoModule.BUILTIN_PATH_PREFIX}read` }
    const resolved = resolveToolProvenance(toolWithSourceInfo('read', sourceInfo))

    expect(resolved.kind).toBe('builtin')
  })

  it('classifies SDK tools as SDK, not as an extension with a file path', () => {
    const sourceInfo = sourceInfoModule.createSyntheticSourceInfo('<sdk:my_tool>', { source: 'sdk' })
    const resolved = resolveToolProvenance(toolWithSourceInfo('my_tool', sourceInfo))

    expect(resolved.kind).toBe('sdk')
    expect(resolved.extensionName).toBe('SDK')
  })

  it("agrees with Pi's synthetic path classification", () => {
    const paths = [
      `${sourceInfoModule.BUILTIN_PATH_PREFIX}read`,
      `${sourceInfoModule.BUILTIN_PATH_PREFIX}mcp`,
      '<sdk:my_tool>',
      '<sdk:pi-subagents::subagent>',
      '<inline:1>',
      '<inline:my_tool>',
      '<mcp:dev-radius>',
      '/home/user/.pi/agent/npm/node_modules/pi-lens/dist/index.js',
      'dist/extension/index.js',
    ]

    for (const path of paths) {
      expect(syntheticPathSource(path), `classification mismatch for ${path}`).toBe(
        sourceInfoModule.getSyntheticPathSource(path)
      )
      expect(sourceInfoModule.isSyntheticPath(path)).toBe(syntheticPathSource(path) !== undefined)
    }
  })

  it('labels synthetic paths by their source instead of parsing the path', () => {
    for (const [name, path] of [
      ['read', `${sourceInfoModule.BUILTIN_PATH_PREFIX}read`],
      ['my_tool', '<sdk:my_tool>'],
      ['inline_tool', '<inline:my_tool>'],
      ['anon_tool', '<inline:1>'],
    ] as const) {
      const source = sourceInfoModule.getSyntheticPathSource(path)
      expect(source, `${path} should be synthetic`).toBeDefined()
      const resolved = resolveToolProvenance(toolWithSourceInfo(name, { path, source }))

      // A synthetic path is not a file: its label must come from the synthetic
      // source, never from `extractExtensionName` (which would leak "<sdk:my_tool>").
      if (resolved.extensionName) {
        expect(resolved.extensionName, `${path} produced label ${resolved.extensionName}`).not.toMatch(/[<>:]/)
      }
      // The synthetic path is shown as-is; Pi keeps the angle brackets of
      // `<sdk:...>` paths readable, and the viewer never rewrites them.
      expect(resolved.displayPath).toBe(path)
      expect(resolved.kind).toBe(
        source === 'builtin' ? 'builtin' : source === 'sdk' ? 'sdk' : 'extension'
      )
    }
  })

  it('resolves the npm extension shape Pi records in real sessions', () => {
    // Shape observed in captured sessions, built here with Pi's own helper.
    const sourceInfo = sourceInfoModule.createSyntheticSourceInfo(
      '/home/user/.pi/agent/npm/node_modules/pi-lens/dist/index.js',
      { source: 'npm:pi-lens', scope: 'user', origin: 'package', baseDir: '/home/user/.pi/agent/npm/node_modules/pi-lens' }
    )
    const resolved = resolveToolProvenance(toolWithSourceInfo('lens_diagnostics', sourceInfo))

    expect(resolved.kind).toBe('extension')
    expect(resolved.extensionName).toBe('pi-lens')
  })
})
