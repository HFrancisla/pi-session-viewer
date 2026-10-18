import { describe, expect, it } from 'vitest'
import {
  createSessionCatalog,
  disambiguateProjectNames,
  normalizePath,
} from './session-catalog'
import type { SessionListItem } from './types'

describe('SessionCatalog domain module', () => {
  describe('path normalization and disambiguation', () => {
    it('normalizes backslashes and trailing slashes', () => {
      expect(normalizePath('C:\\Users\\admin\\project\\')).toBe('C:/Users/admin/project')
      expect(normalizePath('/home/user/repo//')).toBe('/home/user/repo')
      expect(normalizePath(null)).toBe('')
      expect(normalizePath('')).toBe('')
    })

    it('preserves single or distinct project basenames without extra prefix', () => {
      const names = disambiguateProjectNames([
        '/home/user/workspace/project-alpha',
        '/home/user/workspace/project-beta',
      ])
      expect(names.get('/home/user/workspace/project-alpha')).toBe('project-alpha')
      expect(names.get('/home/user/workspace/project-beta')).toBe('project-beta')
    })

    it('automatically adds parent directory prefix when basenames collide', () => {
      const names = disambiguateProjectNames([
        '/home/user/repo-one/server',
        '/home/user/repo-two/server',
        '/home/user/workspace/client',
      ])
      expect(names.get('/home/user/repo-one/server')).toBe('repo-one/server')
      expect(names.get('/home/user/repo-two/server')).toBe('repo-two/server')
      expect(names.get('/home/user/workspace/client')).toBe('client')
    })

    it('expands multiple directory levels when parent directories also collide', () => {
      const names = disambiguateProjectNames([
        '/home/user/work-a/packages/common',
        '/home/user/work-b/packages/common',
      ])
      expect(names.get('/home/user/work-a/packages/common')).toBe('work-a/packages/common')
      expect(names.get('/home/user/work-b/packages/common')).toBe('work-b/packages/common')
    })
  })

  describe('createSessionCatalog', () => {
    const mockSessions: SessionListItem[] = [
      {
        token: 's1',
        id: '1',
        title: 'Session 1',
        cwd: '/home/user/repo-a/server',
        modifiedAt: '2026-09-10T10:00:00.000Z',
        relativePath: 'repo-a.jsonl',
      },
      {
        token: 's2',
        id: '2',
        title: 'Session 2',
        cwd: '/home/user/repo-a/server',
        modifiedAt: '2026-09-12T10:00:00.000Z',
        relativePath: 'repo-a-2.jsonl',
      },
      {
        token: 's3',
        id: '3',
        title: 'Session 3',
        cwd: '/home/user/repo-b/server',
        modifiedAt: '2026-09-11T10:00:00.000Z',
        relativePath: 'repo-b.jsonl',
      },
    ]

    it('groups sessions by unique cwd and sorts projects by latest activity', () => {
      const catalog = createSessionCatalog(mockSessions)
      expect(catalog.projects).toHaveLength(2)

      // repo-a has latest update at 09-12, so it comes first
      expect(catalog.projects[0].cwd).toBe('/home/user/repo-a/server')
      expect(catalog.projects[0].name).toBe('repo-a/server')
      expect(catalog.projects[0].count).toBe(2)

      // repo-b has latest update at 09-11
      expect(catalog.projects[1].cwd).toBe('/home/user/repo-b/server')
      expect(catalog.projects[1].name).toBe('repo-b/server')
      expect(catalog.projects[1].count).toBe(1)
    })

    it('uses one membership rule for subagent paths, mirrors, projects, and initial selection', () => {
      const makeSession = (
        token: string,
        relativePath: string,
        overrides: Partial<SessionListItem> = {},
      ): SessionListItem => ({
        token,
        id: token,
        title: token,
        cwd: '/work/project',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        relativePath,
        ...overrides,
      })
      const sessions = [
        makeSession('plain', 'session.jsonl'),
        makeSession('parent-linked', 'child.jsonl', {
          parentSession: 'parent-id',
          modifiedAt: '2027-01-01T00:00:00.000Z',
        }),
        makeSession('known-origin', 'child.jsonl', { id: 'SuBaGeNt-child' }),
        makeSession('root-artifact', 'subagent-artifacts/child.jsonl'),
        makeSession('nested-subagent', 'project/subagents/child.jsonl'),
        makeSession('windows-subagent', 'project\\subagent-artifacts\\child.jsonl'),
        makeSession('runnable-root', '11111111-1111-4111-8111-111111111111/run-0/session.jsonl'),
        makeSession('runnable-nested', 'project/parent/22222222-2222-4222-8222-222222222222/run-12/session.jsonl'),
        makeSession('runnable-short-id', 'project/parent/7df2/run-0/session.jsonl'),
        makeSession('runnable-named-id', 'project/parent/run-123/run-0/session.jsonl'),
        makeSession('run-notes', 'project/run-notes/session.jsonl'),
        makeSession('ordinary-run-dir', 'run-0/session.jsonl'),
        makeSession('nested-ordinary-run-dir', 'project/run-0/session.jsonl'),
        makeSession('date-dir', '2026-10-18T10-00-00-000Z/session.jsonl'),
        makeSession('case-distinct-dir', 'Subagents/standalone.jsonl'),
        makeSession('transcript-mirror', 'archive/agent_transcript.jsonl'),
        makeSession('case-distinct-transcript', 'archive/agent_Transcript.jsonl'),
        makeSession('empty-parent', 'empty-parent.jsonl', { parentSession: '   ' }),
        makeSession('other-project', 'other.jsonl', {
          cwd: '/work/other-project',
          modifiedAt: '2026-02-01T00:00:00.000Z',
        }),
        makeSession('child-only-project', 'child.jsonl', {
          cwd: '/work/child-only',
          modifiedAt: '2026-12-01T00:00:00.000Z',
          id: 'subagent-latest',
        }),
      ]

      const catalog = createSessionCatalog(sessions)

      expect(catalog.allSessions.map((session) => session.token)).toEqual([
        'plain',
        'run-notes',
        'ordinary-run-dir',
        'nested-ordinary-run-dir',
        'date-dir',
        'case-distinct-dir',
        'case-distinct-transcript',
        'empty-parent',
        'other-project',
      ])
      expect(catalog.projects.map(({ cwd, count }) => ({ cwd, count }))).toEqual([
        { cwd: '/work/other-project', count: 1 },
        { cwd: '/work/project', count: 8 },
      ])
      expect(catalog.findInitialSession('/work/child-only')?.token).toBe('plain')
      expect(catalog.getSessionsForProject('/work/project').map((session) => session.token)).toEqual([
        'plain',
        'run-notes',
        'ordinary-run-dir',
        'nested-ordinary-run-dir',
        'date-dir',
        'case-distinct-dir',
        'case-distinct-transcript',
        'empty-parent',
      ])
    })

    it('retrieves sessions for a project by normalized cwd', () => {
      const catalog = createSessionCatalog(mockSessions)
      const projectASessions = catalog.getSessionsForProject('/home/user/repo-a/server/')
      expect(projectASessions).toHaveLength(2)
      expect(projectASessions.map((s) => s.token)).toEqual(['s1', 's2'])

      const nonExistent = catalog.getSessionsForProject('/unknown')
      expect(nonExistent).toEqual([])
    })

    it('finds initial session matching target or default cwd', () => {
      const catalog = createSessionCatalog(mockSessions, '/home/user/repo-b/server')

      // Uses preferred cwd if given
      const preferred = catalog.findInitialSession('/home/user/repo-a/server/')
      expect(preferred?.token).toBe('s1')

      // Falls back to defaultCwd passed into createSessionCatalog
      const fromDefault = catalog.findInitialSession()
      expect(fromDefault?.token).toBe('s3')

      // Falls back to first session when no match
      const fallback = catalog.findInitialSession('/non/existent')
      expect(fallback?.token).toBe('s1')
    })

    it('resolves disambiguated project name for any cwd', () => {
      const catalog = createSessionCatalog(mockSessions)
      expect(catalog.getProjectName('/home/user/repo-a/server')).toBe('repo-a/server')
      expect(catalog.getProjectName('/home/user/repo-b/server/')).toBe('repo-b/server')
      expect(catalog.getProjectName('/unknown/path')).toBe('path')
      expect(catalog.getProjectName(null)).toBe('Unknown Project')
    })

    it('formats session tooltip with exact file name, working directory, and full path', () => {
      const catalog = createSessionCatalog(mockSessions)
      const session: SessionListItem = {
        token: 'token123',
        id: 'session-id',
        title: 'Fix issue',
        cwd: '/home/hzf/workspace/agent-projects',
        modifiedAt: '2026-09-16T10:00:00.000Z',
        relativePath: '--home-hzf-workspace-agent-projects--/2026-08-20T05-39-20-410Z_01a01dae.jsonl',
      }

      const tooltip = catalog.formatSessionTooltip(session, '/home/hzf/.pi/agent/sessions')
      expect(tooltip).toBe(
        'File: 2026-08-20T05-39-20-410Z_01a01dae.jsonl\n' +
        'Working directory: /home/hzf/workspace/agent-projects\n' +
        'Full path: /home/hzf/.pi/agent/sessions/--home-hzf-workspace-agent-projects--/2026-08-20T05-39-20-410Z_01a01dae.jsonl',
      )
    })
  })
})
