import type {
  BranchOption,
  ParsedEntry,
  ParsedSession,
  ParseWarning,
  RawObject,
  SessionHeader,
} from './types'
import { truncate } from './format'

/**
 * Entry types this parser models. Asserted against Pi's own
 * `docs/session-format.md` by `tests/pi-entry-contract.test.ts`, so a new Pi
 * entry type cannot silently degrade into an "Unknown event" row.
 */
export const KNOWN_ENTRY_TYPES = new Set([
  'message',
  'model_change',
  'thinking_level_change',
  'compaction',
  'branch_summary',
  'context_edit',
  'usage',
  'custom',
  'custom_message',
  'label',
  'session_info',
])

function isObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((block) => {
      if (!isObject(block)) return ''
      if (block.type === 'text') return stringValue(block.text) ?? ''
      if (block.type === 'thinking') return stringValue(block.thinking) ?? ''
      if (block.type === 'image') return `[Image ${stringValue(block.mimeType) ?? 'unknown format'}]`
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

export function getPath(entries: ParsedEntry[], leafId: string, warnings?: ParseWarning[]): ParsedEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const path: ParsedEntry[] = []
  const seen = new Set<string>()
  let cursor: ParsedEntry | undefined = byId.get(leafId)

  while (cursor) {
    if (seen.has(cursor.id)) {
      if (warnings && !warnings.some((warning) => warning.code === 'cycle' && warning.line === cursor?.line)) {
        warnings.push({ code: 'cycle', line: cursor.line, message: `Cycle detected at line ${cursor.line} on parentId; path stopped here.` })
      }
      break
    }
    seen.add(cursor.id)
    path.push(cursor)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }

  const orderedPath: ParsedEntry[] = []
  for (let index = path.length - 1; index >= 0; index -= 1) orderedPath.push(path[index])
  return orderedPath
}

function buildBranches(entries: ParsedEntry[], currentLeafId: string | null): BranchOption[] {
  if (!entries.length) return []
  const parentIds = new Set(entries.map((entry) => entry.parentId).filter((value): value is string => Boolean(value)))
  const leaves = entries.filter((entry) => !parentIds.has(entry.id))
  const labelByTarget = new Map<string, string>()

  for (const entry of entries) {
    if (entry.type === 'label') {
      const targetId = stringValue(entry.raw.targetId)
      const label = stringValue(entry.raw.label)
      if (targetId && label) labelByTarget.set(targetId, label)
    }
  }

  const ordered = leaves.sort((a, b) => {
    if (a.id === currentLeafId) return -1
    if (b.id === currentLeafId) return 1
    return (b.timestamp ?? '').localeCompare(a.timestamp ?? '')
  })

  return ordered.map((leaf, index) => {
    const path = getPath(entries, leaf.id)
    let named: string | undefined
    for (let pathIndex = path.length - 1; pathIndex >= 0 && !named; pathIndex -= 1) {
      named = labelByTarget.get(path[pathIndex].id)
    }
    const isCurrent = leaf.id === currentLeafId
    let label = named
    if (!label) label = isCurrent ? 'Current branch' : `Historical branch ${index + (currentLeafId ? 0 : 1)}`
    return {
      leafId: leaf.id,
      label,
      timestamp: leaf.timestamp,
      isCurrent,
    }
  })
}

export function parseSessionJsonl(content: string, sourceName = 'Local file'): ParsedSession {
  const warnings: ParseWarning[] = []
  const entries: ParsedEntry[] = []
  const seenIds = new Set<string>()
  let header: SessionHeader | null = null

  for (const [lineIndex, sourceLine] of content.split(/\r?\n/).entries()) {
    const line = sourceLine.trim()
    if (!line) continue
    const lineNumber = lineIndex + 1
    let raw: unknown

    try {
      raw = JSON.parse(line)
    } catch {
      warnings.push({ code: 'invalid-json', line: lineNumber, message: `Line ${lineNumber} is not valid JSON; skipped.` })
      continue
    }

    if (!isObject(raw)) {
      warnings.push({ code: 'invalid-entry', line: lineNumber, message: `Line ${lineNumber} is not a JSON object; skipped.` })
      continue
    }

    if (!header && raw.type === 'session') {
      header = raw as SessionHeader
      continue
    }

    const id = stringValue(raw.id)
    const type = stringValue(raw.type)
    if (!id || !type) {
      warnings.push({ code: 'invalid-entry', line: lineNumber, message: `Line ${lineNumber} is missing id or type; skipped.` })
      continue
    }
    if (seenIds.has(id)) {
      warnings.push({ code: 'duplicate-id', line: lineNumber, message: `Duplicate id "${id}" at line ${lineNumber}; skipped.` })
      continue
    }
    seenIds.add(id)
    if (!KNOWN_ENTRY_TYPES.has(type)) {
      warnings.push({ code: 'unknown-type', line: lineNumber, message: `Unknown event type "${type}" at line ${lineNumber}; preserved.` })
    }

    entries.push({
      id,
      parentId: raw.parentId === null ? null : stringValue(raw.parentId) ?? null,
      type,
      timestamp: stringValue(raw.timestamp),
      line: lineNumber,
      raw,
    })
  }

  if (!header) {
    warnings.unshift({ code: 'invalid-header', message: 'Missing session header entry; parsed remaining entries.' })
  }

  const ids = new Set(entries.map((entry) => entry.id))
  for (const entry of entries) {
    if (entry.parentId && !ids.has(entry.parentId)) {
      warnings.push({
        code: 'missing-parent',
        line: entry.line,
        message: `Line ${entry.line} references non-existent parentId "${entry.parentId}".`,
      })
    }
  }

  const currentLeafId = entries.at(-1)?.id ?? null
  if (currentLeafId) getPath(entries, currentLeafId, warnings)
  const branches = buildBranches(entries, currentLeafId)
  return {
    sourceName,
    header,
    entries,
    warnings,
    branches,
    currentLeafId,
  }
}

export function getSessionTitle(session: ParsedSession): string {
  let name: string | undefined
  for (let index = session.entries.length - 1; index >= 0 && !name; index -= 1) {
    const entry = session.entries[index]
    if (entry.type === 'session_info') name = stringValue(entry.raw.name)
  }
  if (name) return name
  // The first user message on the current branch, read from the entry list. A
  // title is shown on every render, so it must not build the whole view: that
  // turned each render into O(session) work on multi-megabyte sessions.
  if (!session.currentLeafId) return session.sourceName
  for (const entry of getPath(session.entries, session.currentLeafId)) {
    if (entry.type !== 'message') continue
    const message = isObject(entry.raw.message) ? entry.raw.message : {}
    if (message.role !== 'user') continue
    return truncate(contentText(message.content))
  }
  return session.sourceName
}
