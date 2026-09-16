import { describe, expect, it } from 'vitest'
import { consumeAccessToken, type TokenStorage } from '../src/web/session-auth'

function storage(initial: Record<string, string> = {}): TokenStorage {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('session viewer access token', () => {
  it('stores a fragment token in session storage and clears it from the address', () => {
    const values = storage()
    let cleared = false

    const token = consumeAccessToken('#token=secret-token', values, () => { cleared = true })

    expect(token).toBe('secret-token')
    expect(values.getItem('pi-session-viewer.access-token')).toBe('secret-token')
    expect(cleared).toBe(true)
  })
})
