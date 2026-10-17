import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Access to the installed `@earendil-works/pi-coding-agent` package.
 *
 * The viewer must work with whatever Pi the user actually runs, so the tests
 * compare against Pi itself instead of against hand-written prompt strings.
 * Pi's package `exports` map only exposes the root, therefore internals are
 * loaded by absolute path. If Pi moves those files, the helpers below fail with
 * an actionable message instead of silently testing nothing.
 */
const PACKAGE_NAME = '@earendil-works/pi-coding-agent'

/**
 * Pi uses an `exports` map with only an `import` condition, so CJS
 * `require.resolve` cannot find it. Resolve through the ESM resolver, then fall
 * back to scanning `node_modules` upwards from the repository root.
 */
function resolvePiPackageDir(): string {
  try {
    const resolved = (import.meta as { resolve?: (specifier: string) => string }).resolve?.(PACKAGE_NAME)
    if (resolved) {
      const entry = resolved.startsWith('file:') ? new URL(resolved).pathname : resolved
      return path.dirname(path.dirname(entry))
    }
  } catch {
    // fall through to the node_modules scan
  }

  let directory = path.resolve(process.cwd())
  while (true) {
    const candidate = path.join(directory, 'node_modules', ...PACKAGE_NAME.split('/'))
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`Cannot locate ${PACKAGE_NAME}. Install it (npm install) so the contract tests can compare against Pi.`)
}

export const PI_PACKAGE_DIR = resolvePiPackageDir()
export const PI_VERSION: string = JSON.parse(
  readFileSync(path.join(PI_PACKAGE_DIR, 'package.json'), 'utf8')
).version

// Kept for callers that only want the loaded entry point.
export const PI_ENTRY_PATH = path.join(PI_PACKAGE_DIR, 'dist/index.js')
void require

export async function importPiInternal<T>(relativePath: string): Promise<T> {
  const target = path.join(PI_PACKAGE_DIR, relativePath)
  try {
    return (await import(pathToFileURL(target).href)) as T
  } catch (error) {
    throw new Error(
      `Cannot load Pi internal "${relativePath}" from ${PI_PACKAGE_DIR}. ` +
        `Pi changed its package layout; update tests/helpers/pi-runtime.ts. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export interface PiSystemPromptModule {
  buildSystemPrompt(options: Record<string, unknown>): string
  buildSystemPromptSections(options: Record<string, unknown>): Record<string, string>
  normalizeBuildSystemPromptOptions?(input: Record<string, unknown>): {
    selectedTools: string[]
    promptGuidelines: string[]
  }
}

export function loadPiSystemPrompt(): Promise<PiSystemPromptModule> {
  return importPiInternal<PiSystemPromptModule>('dist/core/system-prompt.js')
}

export interface PiToolPromptContribution {
  snippet: string
  guidelines: string[]
}

/** Real `promptSnippet`/`promptGuidelines` of Pi's built-in tools. */
export async function loadPiToolContributions(): Promise<Record<string, PiToolPromptContribution>> {
  const contributions: Record<string, PiToolPromptContribution> = {}
  for (const tool of ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'powershell']) {
    let module: Record<string, unknown>
    try {
      module = await importPiInternal<Record<string, unknown>>(`dist/core/tools/${tool}.js`)
    } catch {
      continue
    }
    for (const value of Object.values(module)) {
      const candidate = value as { name?: string; snippet?: unknown; guidelines?: unknown } | null
      if (candidate && typeof candidate === 'object' && typeof candidate.snippet === 'string') {
        contributions[candidate.name ?? tool] = {
          snippet: candidate.snippet,
          guidelines: Array.isArray(candidate.guidelines) ? (candidate.guidelines as string[]) : [],
        }
      }
    }
  }
  return contributions
}

/** Normalizes a prompt exactly like the fixture generator does. */
export function normalizePiPackagePaths(prompt: string): string {
  return prompt.split(PI_PACKAGE_DIR).join('<pi-package>')
}
