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
  if (!cwd || cwd === '未知工作目录') return '未知项目'
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
    if (!item.norm || item.norm === '未知工作目录') {
      result.set(item.norm, '未知项目')
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
    const key = normalizePath(session.cwd) || '未知工作目录'
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
    lines.push(`文件：${fileName}`)
  }
  if (session.cwd) {
    lines.push(`工作目录：${session.cwd}`)
  }
  if (rootDir && session.relativePath) {
    const sep = rootDir.endsWith('/') || rootDir.endsWith('\\') ? '' : '/'
    lines.push(`完整路径：${rootDir}${sep}${session.relativePath}`)
  }
  return lines.join('\n')
}

export function createSessionCatalog(
  sessions: SessionListItem[],
  defaultCwd?: string | null,
): SessionCatalog {
  const projects = buildProjectSummaries(sessions)
  const sessionsByProject = new Map<string, SessionListItem[]>()
  const projectNamesByNormCwd = new Map<string, string>()

  for (const project of projects) {
    projectNamesByNormCwd.set(normalizePath(project.cwd), project.name)
  }

  for (const session of sessions) {
    const key = normalizePath(session.cwd) || '未知工作目录'
    const list = sessionsByProject.get(key)
    if (list) {
      list.push(session)
    } else {
      sessionsByProject.set(key, [session])
    }
  }

  return {
    projects,
    allSessions: sessions,
    getSessionsForProject(cwd: string): SessionListItem[] {
      const key = normalizePath(cwd) || '未知工作目录'
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
        const matched = sessions.find((s) => normalizePath(s.cwd) === normTarget)
        if (matched) return matched
      }
      return sessions[0]
    },
    formatSessionTooltip,
  }
}
