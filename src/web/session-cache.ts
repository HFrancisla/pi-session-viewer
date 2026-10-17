import { createLruCache } from '../core/lru-cache'
import type { ContextProjection, ParsedSession } from '../core/types'

/**
 * A session the browser has already parsed.
 *
 * Revisiting a session is the viewer's most common expensive gesture: the server
 * ships the whole JSONL (megabytes), the browser receives it, parses the JSON, and
 * builds the timeline. Keeping the parsed result turns that work into a lookup.
 * Raw content stays inside this bounded cache with its parse, so navigation frames
 * can keep only the session identity and use the cache to restore exact versions.
 *
 * `token` and `modifiedAt` are the entry's own identity: they are what makes the
 * entry findable again, and they are copied out so a recalled session can be
 * re-remembered (or displayed) without asking the server for its version.
 */
export interface CachedSession {
  token: string
  modifiedAt: string
  content: string
  parsed: ParsedSession
  contextProjections: Record<string, ContextProjection> | null
}

export interface SessionCachePolicy {
  maxEntries: number
  maxBytes: number
}

export interface SessionCache {
  recall(key: string): CachedSession | undefined
  /** Look up the newest cached version when the caller has only a session token. */
  recallByToken(token: string): CachedSession | undefined
  remember(key: string, entry: CachedSession): void
  clear(): void
  readonly entries: number
  readonly bytes: number
}

/**
 * A session's identity for caching purposes.
 *
 * The token alone is not enough: Pi appends to session files while the viewer is
 * open, so a token-keyed cache would silently serve a stale timeline. `modifiedAt`
 * is already part of the catalog the client holds, so including it costs no extra
 * request — a changed file simply misses.
 */
export function sessionCacheKey(token: string, modifiedAt: string): string {
  return `${token}\u0000${modifiedAt}`
}

/**
 * Roughly what one entry keeps alive: the raw string plus the objects parsed out
 * of it. Measured at 1.5–2× the file size, so counting 2× the string keeps the
 * budget on the safe side of the estimate.
 */
function estimateBytes(entry: CachedSession): number {
  return entry.content.length * 2
}

/**
 * Bounded by bytes, not by count: one conversation can be 20 MB parsed, and an
 * unbounded cache would turn "browse a few sessions" into an out-of-memory tab.
 * Six entries of roughly 16 MB fit; the largest sessions simply do not stay.
 */
const DEFAULT_POLICY: SessionCachePolicy = { maxEntries: 6, maxBytes: 96 * 1024 * 1024 }

export function createSessionCache(policy: SessionCachePolicy = DEFAULT_POLICY): SessionCache {
  const cache = createLruCache<CachedSession>({
    maxEntries: policy.maxEntries,
    maxWeight: policy.maxBytes,
    weigh: estimateBytes,
  })
  const keyByToken = new Map<string, string>()
  return {
    recall: (key) => cache.get(key),
    recallByToken(token) {
      const key = keyByToken.get(token)
      if (!key) return undefined
      const entry = cache.get(key)
      // Evicted entries must not leave a dangling index behind.
      if (!entry) keyByToken.delete(token)
      return entry
    },
    remember(key, entry) {
      cache.set(key, entry)
      keyByToken.set(entry.token, key)
    },
    clear: () => {
      cache.clear()
      keyByToken.clear()
    },
    get entries() {
      return cache.size
    },
    get bytes() {
      return cache.weight
    },
  }
}

/** The viewer's single client-side session cache. */
export const sessionCache = createSessionCache()
