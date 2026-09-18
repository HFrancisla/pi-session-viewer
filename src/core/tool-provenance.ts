import type { CapturedToolDefinition, ToolSourceInfo } from './types'

export interface ResolvedToolProvenance {
  kind: 'builtin' | 'extension' | 'sdk' | 'unknown'
  isBuiltin: boolean
  extensionName?: string
  displayPath?: string
  rawPath?: string
}

export interface ApiToolDefinition {
  name: string
  description?: string
  parameters?: unknown
}

/**
 * Strips internal host runtime metadata (like sourceInfo and promptGuidelines)
 * and returns only the tool schema fields actually sent to the LLM Tools API.
 */
export function sanitizeToolForApi(tool: CapturedToolDefinition): ApiToolDefinition {
  const result: ApiToolDefinition = { name: tool.name }
  if (tool.description !== undefined) {
    result.description = tool.description
  }
  if (tool.parameters !== undefined) {
    result.parameters = tool.parameters
  }
  return result
}


export const BUILTIN_TOOL_NAMES = new Set([
  'read',
  'bash',
  'edit',
  'write',
  'find',
  'grep',
  'ls',
  'powershell',
])

/**
 * Normalizes user home directories in paths to '~' for clean, readable display.
 */
export function formatDisplayPath(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined
  if (rawPath.startsWith('<') && rawPath.endsWith('>')) {
    return rawPath
  }
  return rawPath
    .replace(/^([a-zA-Z]:)?[\\/]Users[\\/][^\\/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')
    .replace(/\\/g, '/')
}

/**
 * Extracts clean extension identifier from source field, stripping prefixes like npm:
 */
export function cleanSourceIdentifier(source: string | undefined): string | undefined {
  if (!source) return undefined
  if (['builtin', 'sdk', 'local', 'temporary'].includes(source)) return undefined
  return source.replace(/^(?:npm|git|github):/, '')
}

/**
 * Extracts a readable extension name from a file path or package path.
 */
export function extractExtensionName(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined

  const normalized = filePath.replace(/\\/g, '/')

  // 1. node_modules/@scope/pkg or node_modules/pkg
  const nmMatch = normalized.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  if (nmMatch && nmMatch[1]) {
    return nmMatch[1]
  }

  // 2. .pi/extensions/<name> or extensions/<name>
  const extDirMatch = normalized.match(/(?:^|\/)\.?extensions\/([^/]+)/)
  if (extDirMatch && extDirMatch[1]) {
    const segment = extDirMatch[1]
    const clean = segment.replace(/\.[a-zA-Z0-9]+$/, '')
    if (clean !== 'index') {
      return clean
    }
  }

  // 3. Parent directory of index.ts/js (or parent of dist/build/src/extensions)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length > 0) {
    const last = parts[parts.length - 1]
    if (/^index\.[a-zA-Z0-9]+$/.test(last) && parts.length > 1) {
      const parent = parts[parts.length - 2]
      if (['dist', 'build', 'src', 'lib', 'extensions'].includes(parent) && parts.length > 2) {
        return parts[parts.length - 3]
      }
      return parent
    }
    return last.replace(/\.[a-zA-Z0-9]+$/, '')
  }

  return undefined
}

/**
 * Resolves tool provenance (builtin, extension name, display path)
 * from a tool definition or tool name.
 */
export function resolveToolProvenance(
  tool?: CapturedToolDefinition,
  fallbackToolName?: string
): ResolvedToolProvenance {
  const name = tool?.name ?? fallbackToolName ?? ''
  const sourceInfo = (tool?.sourceInfo ?? {}) as ToolSourceInfo

  const rawPath = typeof sourceInfo.path === 'string' ? sourceInfo.path : undefined
  const source = typeof sourceInfo.source === 'string' ? sourceInfo.source : undefined
  const isBuiltinPath = rawPath ? (rawPath.startsWith('<builtin:') || rawPath === '<builtin>') : false

  // 1. Explicit Built-in tools: runtime says builtin or path is <builtin:...>
  if (source === 'builtin' || isBuiltinPath) {
    const path = rawPath ?? `<builtin:${name}>`
    return {
      kind: 'builtin',
      isBuiltin: true,
      displayPath: formatDisplayPath(path),
      rawPath: path,
    }
  }

  // 2. SDK tools
  if (source === 'sdk') {
    return {
      kind: 'sdk',
      isBuiltin: false,
      extensionName: 'SDK',
      displayPath: formatDisplayPath(rawPath),
      rawPath,
    }
  }

  // 3. Extension tools with concrete file path (e.g. overriding builtin tools or custom tools)
  if (rawPath) {
    const extName =
      extractExtensionName(rawPath) ||
      (typeof sourceInfo.baseDir === 'string' ? extractExtensionName(sourceInfo.baseDir) : undefined) ||
      cleanSourceIdentifier(source)

    return {
      kind: 'extension',
      isBuiltin: false,
      extensionName: extName,
      displayPath: formatDisplayPath(rawPath),
      rawPath,
    }
  }

  // 4. Source field specified as extension identifier (without file path)
  const extFromSource = cleanSourceIdentifier(source)
  if (extFromSource) {
    return {
      kind: 'extension',
      isBuiltin: false,
      extensionName: extFromSource,
    }
  }

  // 5. Fallback for built-in tools ONLY when there is no file path and no extension source
  if (BUILTIN_TOOL_NAMES.has(name)) {
    const path = `<builtin:${name}>`
    return {
      kind: 'builtin',
      isBuiltin: true,
      displayPath: formatDisplayPath(path),
      rawPath: path,
    }
  }

  // 6. Unknown / missing sourceInfo
  return {
    kind: 'unknown',
    isBuiltin: false,
  }
}


/**
 * Formats the badge label for a tool based on current locale texts.
 */
export function getToolProvenanceLabel(
  provenance: ResolvedToolProvenance,
  localeTexts: {
    builtin: string
    extension: string
    sdk: string
    unknown: string
  }
): string {
  if (provenance.isBuiltin) {
    return localeTexts.builtin
  }
  if (provenance.extensionName) {
    return provenance.extensionName
  }
  if (provenance.kind === 'sdk') {
    return localeTexts.sdk
  }
  if (provenance.kind === 'extension') {
    return localeTexts.extension
  }
  return localeTexts.unknown
}
