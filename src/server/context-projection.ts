import { parseSessionJsonl } from '../core/session-parser'
import type { ContextExclusion, ContextProjection } from '../core/types'
import { importFromPi, resolvePiVersion } from './pi-runtime'

/**
 * The part of Pi's public API this module calls. `buildSessionProjection` is
 * exported from the package root and resolves the model-visible messages for a
 * branch, applying `context_edit` omissions/replacements and compaction.
 */
interface PiContextApi {
  buildSessionProjection(
    entries: unknown[],
    leafId?: string | null
  ): { entries: Array<{ sourceEntry: { id?: string; type?: string }; messages: unknown[] }> }
  parseSessionEntries(content: string): unknown[]
}

/** Entry types whose projection can be empty purely because a context edit removed them. */
const CONTEXT_PRODUCING_TYPES = new Set(['message', 'custom_message'])

/** Bounds how many branches are projected per request. */
const MAX_PROJECTED_LEAVES = 8

let cachedApi: Promise<PiContextApi | undefined> | undefined

/**
 * Where Pi keeps the pure projection functions, most specific first.
 *
 * `dist/core/session-manager.js` exports both functions the viewer needs and its
 * transitive imports are small; the package root re-exports the whole CLI and tool
 * runtime. Measured on Pi 1.3.0: 266 ms / +8 MB against 1884 ms / +50 MB. The root
 * stays as a fallback for a Pi release that moves or renames the internal module.
 */
export const PI_CONTEXT_API_MODULES = ['dist/core/session-manager.js', 'dist/index.js']

function isPiContextApi(module: unknown): module is PiContextApi {
  if (!module || typeof module !== 'object') return false
  const candidate = module as Record<string, unknown>
  return typeof candidate.buildSessionProjection === 'function'
    && typeof candidate.parseSessionEntries === 'function'
}

/**
 * Loads Pi's own projection implementation.
 *
 * The viewer never reimplements this: a projection decides what the model saw, so
 * the only trustworthy source is Pi itself. `undefined` means Pi could not be
 * loaded here (for example a standalone server without Pi installed), and callers
 * must then report no projection at all rather than an approximation.
 */
export function loadPiContextApi(): Promise<PiContextApi | undefined> {
  if (!cachedApi) {
    cachedApi = importFromPi<PiContextApi>(PI_CONTEXT_API_MODULES, isPiContextApi)
  }
  return cachedApi
}

/** Test seam: forget the cached module so a different Pi install can be probed. */
export function resetPiContextApiCache(): void {
  cachedApi = undefined
}

function collectExclusions(
  projected: Array<{ sourceEntry: { id?: string; type?: string }; messages: unknown[] }>,
  editIdByTarget: Map<string, string>
): Record<string, ContextExclusion> {
  const excluded: Record<string, ContextExclusion> = {}
  for (const entry of projected) {
    const id = entry.sourceEntry.id
    const type = entry.sourceEntry.type
    if (!id || !type || !CONTEXT_PRODUCING_TYPES.has(type)) continue
    // Only messages a context edit removed are attributed to that edit; anything
    // else that produces no message (a compaction boundary, for instance) is
    // reported without an edit so the UI never blames the wrong entry.
    if (entry.messages.length > 0) continue
    const editId = editIdByTarget.get(id)
    excluded[id] = editId ? { state: 'omitted', editId } : { state: 'not-in-context' }
  }
  return excluded
}

/** Target ids of the context edits that omit an entry (`replacement: null`). */
function omittedTargets(content: string): Map<string, string> {
  const byTarget = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (!line.includes('"context_edit"')) continue
    let parsed: { type?: unknown; id?: unknown; targetId?: unknown; replacement?: unknown }
    try {
      parsed = JSON.parse(line) as typeof parsed
    } catch {
      continue
    }
    if (parsed.type !== 'context_edit') continue
    if (typeof parsed.id !== 'string' || typeof parsed.targetId !== 'string') continue
    // A non-null replacement keeps the message visible with new content, and a
    // later edit on the same target wins, so the last one decides.
    if (parsed.replacement === null || parsed.replacement === undefined) {
      byTarget.set(parsed.targetId, parsed.id)
    } else {
      byTarget.delete(parsed.targetId)
    }
  }
  return byTarget
}

/**
 * Computes what the model actually received on each branch of a session.
 *
 * Returns `undefined` when Pi's projection API is unavailable — the caller must
 * show no context marks rather than a guess.
 */
export async function computeContextProjections(
  content: string,
  sourceName = 'session'
): Promise<Record<string, ContextProjection> | undefined> {
  const api = await loadPiContextApi()
  if (!api) return undefined

  let entries: unknown[]
  try {
    entries = api.parseSessionEntries(content)
  } catch {
    return undefined
  }

  // Branch leaves come from the viewer's own parser (a parentId graph walk, not a
  // context decision), so the projection stays Pi's job.
  const parsed = parseSessionJsonl(content, sourceName)
  const leafIds = parsed.branches.map((branch) => branch.leafId)
  const cappedLeaves = leafIds.slice(0, MAX_PROJECTED_LEAVES)
  if (parsed.currentLeafId && !cappedLeaves.includes(parsed.currentLeafId)) {
    cappedLeaves.unshift(parsed.currentLeafId)
  }

  const editIdByTarget = omittedTargets(content)
  const piVersion = resolvePiVersion()
  const projections: Record<string, ContextProjection> = {}

  for (const leafId of cappedLeaves) {
    let projection
    try {
      projection = api.buildSessionProjection(entries, leafId)
    } catch {
      continue
    }
    const messageCount = projection.entries.reduce((total, entry) => total + entry.messages.length, 0)
    projections[leafId] = {
      leafId,
      messageCount,
      contextEntryCount: projection.entries.length,
      excluded: collectExclusions(projection.entries, editIdByTarget),
      piVersion,
    }
  }

  return Object.keys(projections).length > 0 ? projections : undefined
}
