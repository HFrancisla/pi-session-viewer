export const ACCESS_TOKEN_STORAGE_KEY = 'pi-session-viewer.access-token'

export interface TokenStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function consumeAccessToken(hash: string, storage: TokenStorage, clearAddress: () => void): string | null {
  const token = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('token')?.trim()
  if (token) {
    storage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
    clearAddress()
    return token
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
