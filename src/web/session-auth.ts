export const ACCESS_TOKEN_STORAGE_KEY = 'pi-session-viewer.access-token'
export const INITIAL_CWD_STORAGE_KEY = 'pi-session-viewer.initial-cwd'

export interface TokenStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function consumeAccessToken(hash: string, storage: TokenStorage, clearAddress: () => void): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const token = params.get('token')?.trim()
  const cwd = params.get('cwd')?.trim()
  if (cwd) {
    storage.setItem(INITIAL_CWD_STORAGE_KEY, cwd)
  }
  if (token) {
    storage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
    clearAddress()
    return token
  }
  if (cwd) {
    clearAddress()
  }
  return storage.getItem(ACCESS_TOKEN_STORAGE_KEY)
}

export function browserAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return consumeAccessToken(
    window.location.hash,
    window.sessionStorage,
    () => window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`),
  )
}

export function browserInitialCwd(): string | null {
  if (typeof window === 'undefined') return null
  const hashParams = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash)
  const hashCwd = hashParams.get('cwd')?.trim()
  if (hashCwd) return hashCwd
  const queryParams = new URLSearchParams(window.location.search)
  const queryCwd = queryParams.get('cwd')?.trim()
  if (queryCwd) return queryCwd
  return window.sessionStorage.getItem(INITIAL_CWD_STORAGE_KEY)
}
