import { describe, expect, it } from 'vitest'
import { browserOpenCandidates, isWslRuntime, openDefaultBrowser } from '../src/extension/open-browser'

const url = 'http://127.0.0.1:43210/#token=abc&cwd=%2Fworkspace'

describe('browser opener', () => {
  it('detects WSL from its environment or Microsoft kernel release', () => {
    expect(isWslRuntime('linux', { WSL_DISTRO_NAME: 'Ubuntu' }, '6.6.87.2-microsoft-standard-WSL2')).toBe(true)
    expect(isWslRuntime('linux', {}, '6.6.87.2-microsoft-standard-WSL2')).toBe(true)
    expect(isWslRuntime('linux', {}, '6.8.0-generic')).toBe(false)
    expect(isWslRuntime('win32', { WSL_DISTRO_NAME: 'Ubuntu' }, 'ignored')).toBe(false)
  })

  it('uses shell-free Windows launchers so token URLs remain one argument', () => {
    expect(browserOpenCandidates(url, 'win32', {}, 'Windows')).toEqual([
      { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] },
      { command: 'explorer.exe', args: [url] },
    ])
  })

  it('prefers the Windows host from WSL and keeps Linux launchers as fallbacks', () => {
    expect(browserOpenCandidates(url, 'linux', { WSL_INTEROP: '/run/WSL/1_interop' }, '6.8.0')).toEqual([
      { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] },
      { command: 'explorer.exe', args: [url] },
      { command: 'wslview', args: [url] },
      { command: 'xdg-open', args: [url] },
      { command: 'gio', args: ['open', url] },
    ])
  })

  it('falls back to the next launcher when an earlier WSL launcher is unavailable', async () => {
    const attempts: Array<{ command: string, args: string[] }> = []

    await openDefaultBrowser(url, {
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      release: '6.8.0',
      launchCommand: async (command, args) => {
        attempts.push({ command, args })
        if (command === 'rundll32.exe') throw new Error('missing')
      },
    })

    expect(attempts).toEqual([
      { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] },
      { command: 'explorer.exe', args: [url] },
    ])
  })

  it('uses the native desktop launcher on macOS and regular Linux', () => {
    expect(browserOpenCandidates(url, 'darwin', {}, 'Darwin')).toEqual([
      { command: 'open', args: [url] },
    ])
    expect(browserOpenCandidates(url, 'linux', {}, '6.8.0-generic')).toEqual([
      { command: 'xdg-open', args: [url] },
      { command: 'gio', args: ['open', url] },
    ])
  })

  it('rejects only after every available launcher fails', async () => {
    const attempts: string[] = []
    await expect(openDefaultBrowser(url, {
      platform: 'linux',
      env: {},
      release: '6.8.0-generic',
      launchCommand: async (command) => {
        attempts.push(command)
        throw new Error(`${command} unavailable`)
      },
    })).rejects.toThrow('gio unavailable')

    expect(attempts).toEqual(['xdg-open', 'gio'])
  })
})
