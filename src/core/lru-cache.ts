/**
 * A bounded least-recently-used cache.
 *
 * The viewer reads files another process keeps appending to, so entries are keyed
 * by file identity (path, mtime, size) rather than by token alone: a changed file
 * changes its key and simply misses, so no invalidation pass is needed.
 *
 * Both bounds are optional and applied on every insert, oldest first:
 * `maxEntries` caps how many values are retained, `maxWeight` caps their combined
 * weight (bytes, typically) so a few large values cannot crowd out the budget.
 * A value heavier than the whole budget is not cached at all.
 */
export interface LruCacheOptions<V> {
  maxEntries: number
  maxWeight?: number
  weigh?: (value: V) => number
}

export interface LruCache<V> {
  get(key: string): V | undefined
  set(key: string, value: V): void
  clear(): void
  readonly size: number
  readonly weight: number
}

export function createLruCache<V>(options: LruCacheOptions<V>): LruCache<V> {
  const { maxEntries, maxWeight, weigh = () => 1 } = options
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('maxEntries must be a positive integer')
  }
  if (maxWeight !== undefined && (!Number.isFinite(maxWeight) || maxWeight < 0)) {
    throw new RangeError('maxWeight must be a non-negative number')
  }

  const entries = new Map<string, { value: V; weight: number }>()
  let weight = 0

  const remove = (key: string): void => {
    const existing = entries.get(key)
    if (!existing) return
    entries.delete(key)
    weight -= existing.weight
  }

  return {
    get(key) {
      const existing = entries.get(key)
      if (!existing) return undefined
      // Re-insert so Map iteration order stays least- to most-recently used.
      entries.delete(key)
      entries.set(key, existing)
      return existing.value
    },
    set(key, value) {
      remove(key)
      const entryWeight = weigh(value)
      if (maxWeight !== undefined && entryWeight > maxWeight) return
      entries.set(key, { value, weight: entryWeight })
      weight += entryWeight
      while (entries.size > maxEntries || (maxWeight !== undefined && weight > maxWeight)) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        remove(oldest)
      }
    },
    clear() {
      entries.clear()
      weight = 0
    },
    get size() {
      return entries.size
    },
    get weight() {
      return weight
    },
  }
}
