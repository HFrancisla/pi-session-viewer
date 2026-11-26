import { spawn } from 'node:child_process'
import { release as osRelease } from 'node:os'

interface BrowserCommand {
  command: string
  args: string[]
}

export interface BrowserOpenOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  release?: string
  launchCommand?: (command: string, args: string[]) => Promise<void>
}

export function isWslRuntime(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  release: string = osRelease(),
): boolean {
  return platform === 'linux'
    && (Boolean(env.WSL_DISTRO_NAME) || Boolean(env.WSL_INTEROP) || /microsoft/i.test(release))
}

export function browserOpenCandidates(
  url: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  release: string = osRelease(),
): BrowserCommand[] {
  if (platform === 'win32') {
    return [
      { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] },
      { command: 'explorer.exe', args: [url] },
    ]
  }

  if (platform === 'darwin') {
    return [{ command: 'open', args: [url] }]
  }

  if (isWslRuntime(platform, env, release)) {
    return [
      { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] },
      { command: 'explorer.exe', args: [url] },
      { command: 'wslview', args: [url] },
      { command: 'xdg-open', args: [url] },
      { command: 'gio', args: ['open', url] },
    ]
  }

  return [
    { command: 'xdg-open', args: [url] },
    { command: 'gio', args: ['open', url] },
  ]
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    let settled = false
    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolve()
    })
  })
}

export async function openDefaultBrowser(url: string, options: BrowserOpenOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const release = options.release ?? osRelease()
  const launchCommand = options.launchCommand ?? spawnDetached
  let lastError: unknown

  for (const candidate of browserOpenCandidates(url, platform, env, release)) {
    try {
      await launchCommand(candidate.command, candidate.args)
      return
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('No supported browser launcher is available')
}
