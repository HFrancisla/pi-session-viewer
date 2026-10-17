import { describe, expect, it } from 'vitest'
import { createLruCache } from './lru-cache'

describe('createLruCache', () => {
  it('returns stored values and misses unknown keys', () => {
    const cache = createLruCache<string>({ maxEntries: 2 })
    cache.set('a', 'A')
    expect(cache.get('a')).toBe('A')
    expect(cache.get('missing')).toBeUndefined()
  })

  it('keeps falsy values distinguishable from a miss', () => {
    const cache = createLruCache<null>({ maxEntries: 1 })
    cache.set('a', null)
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBeUndefined()
  })

  it('evicts the least recently used entry', () => {
    const cache = createLruCache<number>({ maxEntries: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    // Reading 'a' makes 'b' the least recently used.
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('re-setting a key refreshes its position without growing', () => {
    const cache = createLruCache<number>({ maxEntries: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10)
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(10)
    expect(cache.size).toBe(2)
  })

  it('evicts by weight, oldest first', () => {
    const cache = createLruCache<string>({ maxEntries: 10, maxWeight: 10, weigh: (value) => value.length })
    cache.set('a', 'xxx') // 3
    cache.set('b', 'yyy') // 3
    cache.set('c', 'zzz') // 3
    expect(cache.weight).toBe(9)
    cache.get('a')
    cache.set('d', 'wwww') // +4 -> 13, evicts 'b' (least recently used)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe('xxx')
    expect(cache.weight).toBe(10)
  })

  it('does not cache a value heavier than the whole budget', () => {
    const cache = createLruCache<string>({ maxEntries: 4, maxWeight: 5, weigh: (value) => value.length })
    cache.set('small', 'ab')
    cache.set('huge', 'x'.repeat(6))
    expect(cache.get('huge')).toBeUndefined()
    // A rejected value must not flush the entries that do fit.
    expect(cache.get('small')).toBe('ab')
    expect(cache.weight).toBe(2)
  })

  it('clear releases everything', () => {
    const cache = createLruCache<string>({ maxEntries: 2, maxWeight: 100, weigh: (value) => value.length })
    cache.set('a', 'abc')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.weight).toBe(0)
  })

  it('rejects an invalid capacity', () => {
    expect(() => createLruCache({ maxEntries: 0 })).toThrow(RangeError)
    expect(() => createLruCache({ maxEntries: 1.5 })).toThrow(RangeError)
    expect(() => createLruCache({ maxEntries: 1, maxWeight: -1 })).toThrow(RangeError)
  })
})
