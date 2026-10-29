import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizePath } from '../src/core/path'
import {
  buildProjectSummaries,
  disambiguateProjectNames,
  discoverSessionCatalog,
  listSessions,
} from '../src/server/session-discovery'
import type { SessionListItem } from '../src/core/types'
import { piSessionHeader } from './helpers/pi-session'

const directories: string[] = []

afterEach(async () => {
  while (directories.length) {
    await rm(directories.pop() as string, { recursive: true, force: true })
  }
})

describe('SessionCatalogDiscovery at Filesystem Seam', () => {
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

  describe('buildProjectSummaries', () => {
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

    it('groups sessions by unique cwd, disambiguates names, and sorts by activity', () => {
      const { projects, projectNames } = buildProjectSummaries(mockSessions)
      expect(projects).toHaveLength(2)

      expect(projects[0].cwd).toBe('/home/user/repo-a/server')
      expect(projects[0].name).toBe('repo-a/server')
      expect(projects[0].count).toBe(2)

      expect(projects[1].cwd).toBe('/home/user/repo-b/server')
      expect(projects[1].name).toBe('repo-b/server')
      expect(projects[1].count).toBe(1)

      expect(projectNames.get('/home/user/repo-a/server')).toBe('repo-a/server')
      expect(projectNames.get('/home/user/repo-b/server')).toBe('repo-b/server')
    })
  })

  describe('discoverSessionCatalog filesystem traversal', () => {
    it('discovers top-level sessions, excludes subagents/mirrors, and pre-groups catalog', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'pi-session-catalog-test-'))
      directories.push(root)

      const writeSession = async (relPath: string, id: string, cwd: string, extra: Record<string, unknown> = {}) => {
        const fullPath = path.join(root, relPath)
        await mkdir(path.dirname(fullPath), { recursive: true })
        const content = `${piSessionHeader(id, '2026-01-01T10:00:00.000Z', cwd, extra)}\n`
        await writeFile(fullPath, content)
      }

      // Valid sessions
      await writeSession('repo-a/session-1.jsonl', 's1', '/work/repo-a/server')
      await writeSession('repo-a/session-2.jsonl', 's2', '/work/repo-a/server')
      await writeSession('repo-b/session-3.jsonl', 's3', '/work/repo-b/server')
      await writeSession('repo-c/session-4.jsonl', 's4', '/work/client')

      // Subagent / excluded sessions
      await writeSession('subagent-artifacts/child.jsonl', 'sub-1', '/work/repo-a/server', { parentSession: 's1' })
      await writeSession('repo-a/subagents/run-0.jsonl', 'sub-2', '/work/repo-a/server')
      await writeSession('11111111-1111-4111-8111-111111111111/run-0/session.jsonl', 'run-0', '/work/repo-a/server')
      await writeSession('repo-a/run_transcript.jsonl', 'mirror', '/work/repo-a/server')
      await writeSession('events.jsonl', 'events', '/work/repo-a/server')

      const result = await discoverSessionCatalog(root, '/work/repo-b/server')

      expect(result.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3', 's4'])
      expect(result.projects).toHaveLength(3)

      const repoA = result.projects.find((p) => p.cwd === '/work/repo-a/server')
      const repoB = result.projects.find((p) => p.cwd === '/work/repo-b/server')
      const client = result.projects.find((p) => p.cwd === '/work/client')

      expect(repoA?.count).toBe(2)
      expect(repoA?.name).toBe('repo-a/server')
      expect(repoB?.count).toBe(1)
      expect(repoB?.name).toBe('repo-b/server')
      expect(client?.count).toBe(1)
      expect(client?.name).toBe('client')

      // Pre-assigned projectName on sessions
      const s1 = result.sessions.find((s) => s.id === 's1')
      expect(s1?.projectName).toBe('repo-a/server')

      // Initial session token matches preferred currentCwd
      expect(result.initialSessionToken).toBe(result.sessions.find((s) => s.id === 's3')?.token)

      // listSessions alias also works identically
      const listResult = await listSessions(root)
      expect(listResult.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3', 's4'])
    })
  })
})
