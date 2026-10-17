import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent'

function packageJson(packageDir: string): { name?: string; version?: string } | undefined {
  const file = path.join(packageDir, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string }
  } catch {
    return undefined
  }
}

function isPiPackage(packageDir: string): boolean {
  return packageJson(packageDir)?.name === PI_PACKAGE_NAME
}

/**
 * Locates the `@earendil-works/pi-coding-agent` package that is hosting us.
 *
 * Pi's `exports` map has no `require` condition, so `require.resolve` cannot find
 * it, and the viewer is installed outside Pi's own `node_modules`. The CLI entry
 * that started the process (Pi itself, or the viewer's standalone server) is the
 * reliable anchor, with `node_modules` lookup as a fallback for development.
 */
export function resolvePiPackageDir(): string | undefined {
  const entry = process.argv[1]
  if (entry) {
    let directory = path.dirname(path.resolve(entry))
    while (true) {
      if (isPiPackage(directory)) return directory
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }

  let directory = path.resolve(process.cwd())
  while (true) {
    const candidate = path.join(directory, 'node_modules', ...PI_PACKAGE_NAME.split('/'))
    if (isPiPackage(candidate)) return candidate
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  return undefined
}

export function resolvePiVersion(): string | undefined {
  const directory = resolvePiPackageDir()
  return directory ? packageJson(directory)?.version : undefined
}

/**
 * Imports a module from the hosting Pi installation by absolute path.
 *
 * Pi's `exports` map only exposes the root, so internal modules (the session
 * projection, for example) are loaded by path. Returning `undefined` when Pi
 * cannot be located is deliberate: callers must degrade instead of guessing.
 */
export async function importFromPi<T>(relativePath: string): Promise<T | undefined> {
  const directory = resolvePiPackageDir()
  if (!directory) return undefined
  const target = path.join(directory, relativePath)
  if (!existsSync(target)) return undefined
  try {
    return (await import(pathToFileURL(target).href)) as T
  } catch {
    return undefined
  }
}
