import type { SessionListItem } from './types'

export interface ProjectSummary {
  cwd: string
  name: string
  count: number
  latestModifiedAt: string
}

export interface SessionCatalog {
  readonly projects: ProjectSummary[]
  readonly allSessions: SessionListItem[]
  getSessionsForProject(cwd: string): SessionListItem[]
  getProjectName(cwd?: string | null): string
  findInitialSession(preferredCwd?: string | null): SessionListItem | undefined
  formatSessionTooltip(session: SessionListItem, rootDir?: string): string
}

export function normalizePath(cwd?: string | null): string {
  if (!cwd) return ''
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function projectName(cwd: string): string {
  if (!cwd || cwd === 'Unknown working directory') return 'Unknown Project'
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? cwd
}

/**
 * Disambiguates duplicate project directory basenames by prepending the minimum
 * number of parent directory segments required to make each label unique.
 * e.g. ['/a/work/server', '/b/work/server', '/c/client']
 *   -> Map { '/a/work/server' => 'a/work/server', '/b/work/server' => 'b/work/server', '/c/client' => 'client' }
 */
export function disambiguateProjectNames(cwds: string[]): Map<string, string> {
  const result = new Map<string, string>()
  const parsed = cwds.map((cwd) => {
    const norm = normalizePath(cwd)
    const segments = norm.split('/').filter(Boolean)
    return { cwd, norm, segments }
  })

  for (const item of parsed) {
    if (!item.norm || item.norm === 'Unknown working directory') {
      result.set(item.norm, 'Unknown Project')
      continue
    }
    let depth = 1
    while (depth <= item.segments.length) {
      const candidate = item.segments.slice(-depth).join('/')
      const collision = parsed.some((other) => {
        if (other.norm === item.norm) return false
        const otherCandidate = other.segments.slice(-depth).join('/')
        return otherCandidate === candidate
      })
      if (!collision || depth === item.segments.length) {
        result.set(item.norm, candidate)
        break
      }
      depth += 1
    }
  }
  return result
}

function buildProjectSummaries(sessions: SessionListItem[]): ProjectSummary[] {
  const map = new Map<string, { cwd: string; count: number; latestModifiedAt: string }>()
  for (const session of sessions) {
    const key = normalizePath(session.cwd) || 'Unknown working directory'
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        cwd: session.cwd,
        count: 1,
        latestModifiedAt: session.modifiedAt,
      })
    } else {
      existing.count += 1
      if (session.modifiedAt.localeCompare(existing.latestModifiedAt) > 0) {
        existing.latestModifiedAt = session.modifiedAt
      }
    }
  }

  const distinctCwds = Array.from(map.values()).map((item) => item.cwd)
  const disambiguatedNames = disambiguateProjectNames(distinctCwds)

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      name: disambiguatedNames.get(normalizePath(item.cwd)) ?? projectName(item.cwd),
    }))
    .sort((a, b) => b.latestModifiedAt.localeCompare(a.latestModifiedAt))
}

export function formatSessionTooltip(session: SessionListItem, rootDir?: string): string {
  const fileName = session.relativePath.split(/[\\/]/).filter(Boolean).at(-1) ?? session.relativePath
  const lines: string[] = []
  if (fileName) {
    lines.push(`File: ${fileName}`)
  }
  if (session.cwd) {
    lines.push(`Working directory: ${session.cwd}`)
  }
  if (rootDir && session.relativePath) {
    const sep = rootDir.endsWith('/') || rootDir.endsWith('\\') ? '' : '/'
    lines.push(`Full path: ${rootDir}${sep}${session.relativePath}`)
  }
  return lines.join('\n')
}

const SUBAGENT_DIRECTORY_NAMES = new Set(['subagent-artifacts', 'subagents'])
// Pi run IDs are UUIDs; target paths also use short hex and run-<number> IDs.
const RUN_IDENTIFIER = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{4,}|run-\d+)$/i
const RUN_DIRECTORY = /^run-\d+$/

function sessionPathSegments(relativePath: string): string[] {
  return relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
}

function isSubagentPathSegment(segment: string): boolean {
  return SUBAGENT_DIRECTORY_NAMES.has(segment)
}

function hasSubagentPathSegment(segments: string[]): boolean {
  return segments.some(isSubagentPathSegment)
}

export function isSessionCatalogSubtreeExcluded(relativePath: string): boolean {
  return hasSubagentPathSegment(sessionPathSegments(relativePath))
}

function isRunnableSubagentSession(segments: string[]): boolean {
  const runIdentifier = segments.at(-3)
  return Boolean(runIdentifier && RUN_IDENTIFIER.test(runIdentifier))
    && segments.at(-1) === 'session.jsonl'
    && RUN_DIRECTORY.test(segments.at(-2) ?? '')
}

export function isSessionCatalogPathMember(relativePath: string): boolean {
  const segments = sessionPathSegments(relativePath)
  if (hasSubagentPathSegment(segments)) return false
  if (segments.at(-1)?.endsWith('_transcript.jsonl')) return false
  return !isRunnableSubagentSession(segments)
}

/**
 * The one positive membership rule for standalone Session Catalog entries.
 * Child Sessions and transcript mirrors may still be opened by an authorized
 * in-root token; this predicate controls catalog membership only.
 */
export function isSessionCatalogMember(session: SessionListItem): boolean {
  if (session.parentSession?.trim()) return false
  if (session.id.toLowerCase().startsWith('subagent-')) return false
  return isSessionCatalogPathMember(session.relativePath)
}

export function createSessionCatalog(
  sessions: SessionListItem[],
  defaultCwd?: string | null,
): SessionCatalog {
  const mainSessions = sessions.filter(isSessionCatalogMember)
  const projects = buildProjectSummaries(mainSessions)
  const sessionsByProject = new Map<string, SessionListItem[]>()
  const projectNamesByNormCwd = new Map<string, string>()

  for (const project of projects) {
    projectNamesByNormCwd.set(normalizePath(project.cwd), project.name)
  }

  for (const session of mainSessions) {
    const key = normalizePath(session.cwd) || 'Unknown working directory'
    const list = sessionsByProject.get(key)
    if (list) {
      list.push(session)
    } else {
      sessionsByProject.set(key, [session])
    }
  }

  return {
    projects,
    allSessions: mainSessions,
    getSessionsForProject(cwd: string): SessionListItem[] {
      const key = normalizePath(cwd) || 'Unknown working directory'
      return sessionsByProject.get(key) ?? []
    },
    getProjectName(cwd?: string | null): string {
      const norm = normalizePath(cwd)
      return projectNamesByNormCwd.get(norm) ?? projectName(cwd ?? '')
    },
    findInitialSession(preferredCwd?: string | null): SessionListItem | undefined {
      const target = preferredCwd ?? defaultCwd
      if (target) {
        const normTarget = normalizePath(target)
        const matched = mainSessions.find((s) => normalizePath(s.cwd) === normTarget)
        if (matched) return matched
      }
      return mainSessions[0]
    },
    formatSessionTooltip,
  }
}
