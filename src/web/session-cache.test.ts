import { describe, expect, it } from 'vitest'
import { parseSessionJsonl } from '../core/session-parser'
import { createSessionCache, sessionCacheKey } from './session-cache'

function entry(content: string, token = 'test-token', modifiedAt = 'm1') {
  return {
    token,
    modifiedAt,
    content,
    parsed: parseSessionJsonl(content, 'session.jsonl'),
    contextProjections: null,
  }
}

const HEADER = '{"type":"session","version":3,"id":"s1","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/work/demo"}'

function readableSession(text: string): string {
  return [
    HEADER,
    JSON.stringify({
      type: 'message',
      id: 'u1',
      parentId: null,
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'user', timestamp: 1, content: text },
    }),
  ].join('\n')
}

describe('sessionCacheKey', () => {
  it('separates the same session at different versions', () => {
    expect(sessionCacheKey('tok', 'm1')).not.toBe(sessionCacheKey('tok', 'm2'))
  })

  it('separates different sessions at the same version', () => {
    expect(sessionCacheKey('a', 'm1')).not.toBe(sessionCacheKey('b', 'm1'))
  })
})

describe('createSessionCache', () => {
  it('returns a remembered session and its parse', () => {
    const cache = createSessionCache()
    const content = readableSession('hello')
    const remembered = entry(content)
    cache.remember('key', remembered)

    const cached = cache.recall('key')
    expect(cached?.content).toBe(content)
    expect(cached?.parsed.header?.id).toBe('s1')
    expect(cached?.parsed).toBe(remembered.parsed)
  })

  it('misses an unknown key', () => {
    expect(createSessionCache().recall('nope')).toBeUndefined()
  })

  it('recalls the latest remembered version by token for subagent navigation', () => {
    const cache = createSessionCache()
    const first = entry(readableSession('first'), 'child-token', 'm1')
    const latest = entry(readableSession('latest'), 'child-token', 'm2')
    cache.remember(sessionCacheKey(first.token, first.modifiedAt), first)
    cache.remember(sessionCacheKey(latest.token, latest.modifiedAt), latest)

    expect(cache.recallByToken('child-token')).toBe(latest)
  })

  it('evicts the least recently used session when the entry count is reached', () => {
    const cache = createSessionCache({ maxEntries: 2, maxBytes: 1_000_000 })
    cache.remember('a', entry(readableSession('a')))
    cache.remember('b', entry(readableSession('b')))
    cache.recall('a')
    cache.remember('c', entry(readableSession('c')))

    expect(cache.recall('b')).toBeUndefined()
    expect(cache.recall('a')).toBeDefined()
    expect(cache.recall('c')).toBeDefined()
    expect(cache.entries).toBe(2)
  })

  it('evicts by bytes so several large sessions cannot exceed the budget', () => {
    const a = entry(readableSession('a'.repeat(100)))
    const b = entry(readableSession('b'.repeat(100)))
    const c = entry(readableSession('c'.repeat(100)))
    const perEntry = a.content.length * 2
    const cache = createSessionCache({ maxEntries: 10, maxBytes: perEntry * 2 + 1 })

    cache.remember('a', a)
    cache.remember('b', b)
    expect(cache.recall('a')).toBeDefined()
    expect(cache.recall('b')).toBeDefined()

    cache.remember('c', c)
    expect(cache.recall('a')).toBeUndefined()
    expect(cache.recall('b')).toBeDefined()
    expect(cache.recall('c')).toBeDefined()
    expect(cache.bytes).toBeLessThanOrEqual(perEntry * 2 + 1)
  })

  it('drops an oversized session instead of flushing the rest', () => {
    const cache = createSessionCache({ maxEntries: 10, maxBytes: 1_000 })
    const small = entry(readableSession('x'.repeat(20)))
    cache.remember('small', small)
    cache.remember('huge', entry(readableSession('y'.repeat(5_000))))

    expect(cache.recall('huge')).toBeUndefined()
    expect(cache.recall('small')).toBe(small)
    expect(cache.bytes).toBe(small.content.length * 2)
  })

  it('clears every entry and its accounting', () => {
    const cache = createSessionCache()
    cache.remember('a', entry(readableSession('a'), 'a'))
    cache.clear()
    expect(cache.recallByToken('a')).toBeUndefined()
    expect(cache.entries).toBe(0)
    expect(cache.bytes).toBe(0)
  })
})
