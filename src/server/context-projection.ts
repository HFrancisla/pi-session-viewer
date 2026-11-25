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
  ): { entries: Array<{ sourceEntry: { id?: string; type?: string; targetId?: string; replacement?: unknown }; messages: unknown[] }> }
  parseSessionEntries(content: string): unknown[]
}

/** Entry types whose projection can be empty purely because a context edit removed them. */
const CONTEXT_PRODUCING_TYPES = new Set(['message', 'custom_message'])

let cachedApi: Promise<PiContextApi | undefined> | undefined

/**
 * Pi 的原生上下文投影函数所在模块。
 *
 * 从 session-manager 模块直接导入，避免额外初始化 CLI 与 TUI。
 */
const PI_CONTEXT_API_MODULE = 'dist/core/session-manager.js'

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
    cachedApi = importFromPi<PiContextApi>(PI_CONTEXT_API_MODULE, isPiContextApi)
  }
  return cachedApi
}

/** Test seam: forget the cached module so a different Pi install can be probed. */
export function resetPiContextApiCache(): void {
  cachedApi = undefined
}

function collectExclusions(
  projected: Array<{ sourceEntry: { id?: string; type?: string; targetId?: string; replacement?: unknown }; messages: unknown[] }>,
  editIdByTarget: Map<string, string>
): Record<string, ContextExclusion> {
  const excluded: Record<string, ContextExclusion> = Object.create(null)
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

/** Only edits retained in this exact Pi projection can affect its entries. */
function omittedTargets(projected: ReturnType<PiContextApi['buildSessionProjection']>['entries']): Map<string, string> {
  const byTarget = new Map<string, string>()
  for (const { sourceEntry: entry } of projected) {
    if (entry.type !== 'context_edit' || !entry.id || !entry.targetId) continue
    if (entry.replacement === null) byTarget.set(entry.targetId, entry.id)
    else byTarget.delete(entry.targetId)
  }
  return byTarget
}

/**
 * 计算会话各分支的原生持久化上下文投影；并非最终 Provider 请求。
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
  // Projection is branch-relative. Every branch exposed by the Viewer must have
  // a Pi-native projection; silently capping the list makes later branches look
  // as if context information were known-empty.
  const projectedLeaves = leafIds

  const piVersion = resolvePiVersion()
  const projections: Record<string, ContextProjection> = Object.create(null)

  for (const leafId of projectedLeaves) {
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
      excluded: collectExclusions(projection.entries, omittedTargets(projection.entries)),
      piVersion,
    }
  }

  return Object.keys(projections).length > 0 ? projections : undefined
}
