import { describe, expect, it } from 'vitest'
import {
  cleanSourceIdentifier,
  extractExtensionName,
  formatDisplayPath,
  getToolProvenanceLabel,
  resolveToolProvenance,
  sanitizeToolForApi,
} from './tool-provenance'

describe('tool-provenance', () => {
  describe('formatDisplayPath', () => {
    it('normalizes Linux home directory to ~', () => {
      expect(formatDisplayPath('/home/hzf/.pi/agent/extensions/pi-lens/index.ts'))
        .toBe('~/.pi/agent/extensions/pi-lens/index.ts')
    })

    it('normalizes macOS Users directory to ~', () => {
      expect(formatDisplayPath('/Users/alice/.pi/agent/extensions/pi-lens/index.ts'))
        .toBe('~/.pi/agent/extensions/pi-lens/index.ts')
    })

    it('preserves builtin pseudo paths', () => {
      expect(formatDisplayPath('<builtin:read>')).toBe('<builtin:read>')
    })
  })

  describe('extractExtensionName', () => {
    it('extracts directory name inside extensions folder', () => {
      expect(extractExtensionName('/home/user/.pi/agent/extensions/pi-lens/index.ts'))
        .toBe('pi-lens')
      expect(extractExtensionName('/home/user/.pi/agent/extensions/pi-lens/dist/index.js'))
        .toBe('pi-lens')
    })

    it('extracts single file extension name', () => {
      expect(extractExtensionName('/home/user/.pi/agent/extensions/source_check.ts'))
        .toBe('source_check')
    })

    it('extracts npm package name from node_modules', () => {
      expect(extractExtensionName('/path/to/node_modules/pi-mcp-adapter/index.js'))
        .toBe('pi-mcp-adapter')
      expect(extractExtensionName('/path/to/node_modules/@earendil-works/pi-lens/dist/index.js'))
        .toBe('@earendil-works/pi-lens')
    })
  })

  describe('resolveToolProvenance', () => {
    it('resolves built-in tool by name even without sourceInfo', () => {
      const res = resolveToolProvenance(undefined, 'read')
      expect(res.kind).toBe('builtin')
      expect(res.isBuiltin).toBe(true)
      expect(res.rawPath).toBe('<builtin:read>')
      expect(res.displayPath).toBe('<builtin:read>')
    })

    it('resolves built-in tool with builtin sourceInfo', () => {
      const res = resolveToolProvenance({
        name: 'bash',
        sourceInfo: { path: '<builtin:bash>', source: 'builtin' },
      })
      expect(res.kind).toBe('builtin')
      expect(res.isBuiltin).toBe(true)
      expect(res.displayPath).toBe('<builtin:bash>')
    })

    it('resolves extension tool from directory path', () => {
      const res = resolveToolProvenance({
        name: 'module_report',
        sourceInfo: {
          path: '/home/hzf/.pi/agent/extensions/pi-lens/index.ts',
          source: 'local',
        },
      })
      expect(res.kind).toBe('extension')
      expect(res.isBuiltin).toBe(false)
      expect(res.extensionName).toBe('pi-lens')
      expect(res.displayPath).toBe('~/.pi/agent/extensions/pi-lens/index.ts')
      expect(res.rawPath).toBe('/home/hzf/.pi/agent/extensions/pi-lens/index.ts')
    })

    it('resolves extension tool from node_modules package', () => {
      const res = resolveToolProvenance({
        name: 'mcpScript',
        sourceInfo: {
          path: '/work/node_modules/pi-mcp-adapter/index.js',
          source: 'local',
        },
      })
      expect(res.kind).toBe('extension')
      expect(res.isBuiltin).toBe(false)
      expect(res.extensionName).toBe('pi-mcp-adapter')
      expect(res.displayPath).toBe('/work/node_modules/pi-mcp-adapter/index.js')
    })

    it('resolves SDK tool', () => {
      const res = resolveToolProvenance({
        name: 'customSdkTool',
        sourceInfo: { source: 'sdk' },
      })
      expect(res.kind).toBe('sdk')
      expect(res.isBuiltin).toBe(false)
      expect(res.extensionName).toBe('SDK')
    })

    it('resolves tool without sourceInfo as unknown', () => {
      const res = resolveToolProvenance({ name: 'custom_tool' })
      expect(res.kind).toBe('unknown')
      expect(res.isBuiltin).toBe(false)
      expect(res.extensionName).toBeUndefined()
      expect(res.displayPath).toBeUndefined()
    })

    it('resolves overridden built-in tool as extension when it has npm extension sourceInfo', () => {
      const res = resolveToolProvenance({
        name: 'read',
        sourceInfo: {
          path: '/home/hzf/.pi/agent/npm/node_modules/pi-claude-code-ui/extensions/index.ts',
          source: 'npm:pi-claude-code-ui',
          scope: 'user',
          origin: 'package',
          baseDir: '/home/hzf/.pi/agent/npm/node_modules/pi-claude-code-ui',
        },
      })
      expect(res.kind).toBe('extension')
      expect(res.isBuiltin).toBe(false)
      expect(res.extensionName).toBe('pi-claude-code-ui')
      expect(res.displayPath).toBe('~/.pi/agent/npm/node_modules/pi-claude-code-ui/extensions/index.ts')
    })

    it('resolves overridden built-in tool as extension when it has local fff extension path', () => {
      const res = resolveToolProvenance({
        name: 'grep',
        sourceInfo: {
          path: '/home/hzf/.pi/agent/extensions/fff/index.ts',
          source: 'local',
        },
      })
      expect(res.kind).toBe('extension')
      expect(res.isBuiltin).toBe(false)
      expect(res.extensionName).toBe('fff')
      expect(res.displayPath).toBe('~/.pi/agent/extensions/fff/index.ts')
    })
  })

  describe('cleanSourceIdentifier', () => {
    it('strips protocol prefixes like npm:', () => {
      expect(cleanSourceIdentifier('npm:pi-claude-code-ui')).toBe('pi-claude-code-ui')
      expect(cleanSourceIdentifier('github:foo/bar')).toBe('foo/bar')
    })

    it('returns undefined for local, builtin, and sdk', () => {
      expect(cleanSourceIdentifier('local')).toBeUndefined()
      expect(cleanSourceIdentifier('builtin')).toBeUndefined()
      expect(cleanSourceIdentifier('sdk')).toBeUndefined()
    })
  })


  describe('getToolProvenanceLabel', () => {
    const zhLocale = {
      builtin: '原生内置',
      extension: '扩展',
      sdk: 'SDK',
      unknown: '未知来源',
    }

    const enLocale = {
      builtin: 'Built-in',
      extension: 'Extension',
      sdk: 'SDK',
      unknown: 'Unknown',
    }

    it('returns localized label for builtin tools', () => {
      const prov = resolveToolProvenance({ name: 'read' })
      expect(getToolProvenanceLabel(prov, zhLocale)).toBe('原生内置')
      expect(getToolProvenanceLabel(prov, enLocale)).toBe('Built-in')
    })

    it('returns extension name for extension tools', () => {
      const prov = resolveToolProvenance({
        name: 'module_report',
        sourceInfo: { path: '/home/hzf/.pi/agent/extensions/pi-lens/index.ts' },
      })
      expect(getToolProvenanceLabel(prov, zhLocale)).toBe('pi-lens')
      expect(getToolProvenanceLabel(prov, enLocale)).toBe('pi-lens')
    })

    it('returns unknown label for unknown tools', () => {
      const prov = resolveToolProvenance({ name: 'unregistered' })
      expect(getToolProvenanceLabel(prov, zhLocale)).toBe('未知来源')
      expect(getToolProvenanceLabel(prov, enLocale)).toBe('Unknown')
    })
  })

  describe('sanitizeToolForApi', () => {
    it('keeps only name, description, and parameters', () => {
      const tool = {
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        promptGuidelines: ['Do not read sensitive files'],
        sourceInfo: {
          path: '/path/to/ext/index.ts',
          source: 'local',
          scope: 'user',
        },
        extraField: 'should be stripped',
      }

      const sanitized = sanitizeToolForApi(tool)
      expect(sanitized).toEqual({
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      })
      expect((sanitized as any).sourceInfo).toBeUndefined()
      expect((sanitized as any).promptGuidelines).toBeUndefined()
      expect((sanitized as any).extraField).toBeUndefined()
    })

    it('omits description and parameters if undefined', () => {
      const tool = {
        name: 'custom',
        sourceInfo: { path: '/path' },
      }

      const sanitized = sanitizeToolForApi(tool)
      expect(sanitized).toEqual({ name: 'custom' })
    })
  })
})

