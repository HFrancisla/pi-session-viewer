import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizePath } from '../src/core/path'
import {
  buildProjectSummaries,
  disambiguateProjectNames,
  configuredSessionRoot,
  discoverSessionCatalog,
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


  describe('configuredSessionRoot', () => {
    it('follows Pi agent-dir and explicit session-dir environment precedence', () => {
      expect(configuredSessionRoot({ PI_CODING_AGENT_SESSION_DIR: '/tmp/pi-sessions' })).toBe('/tmp/pi-sessions')
      expect(configuredSessionRoot({ PI_CODING_AGENT_DIR: '/tmp/pi-agent' })).toBe('/tmp/pi-agent/sessions')
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
    it('reads a late session_info title beyond the catalog prefix', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'pi-session-title-test-'))
      directories.push(root)
      const file = path.join(root, 'large.jsonl')
      const headerLine = piSessionHeader('large', '2026-01-01T10:00:00.000Z', '/work/demo')
      const user = JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T10:00:01.000Z', message: { role: 'user', content: 'Fallback title' } })
      const filler = JSON.stringify({ type: 'custom', id: 'fill', parentId: 'u1', timestamp: '2026-01-01T10:00:02.000Z', customType: 'filler', data: 'x'.repeat(300_000) })
      const info = JSON.stringify({ type: 'session_info', id: 'info', parentId: 'fill', timestamp: '2026-01-01T10:00:03.000Z', name: 'Late title' })
      await writeFile(file, [headerLine, user, filler, info].join('\n') + '\n')

      const result = await discoverSessionCatalog(root)
      expect(result.sessions[0]?.title).toBe('Late title')
    })

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
      await writeSession('repo-a/forked.jsonl', 'forked', '/work/repo-a/server', { parentSession: '/tmp/source.jsonl' })

      // Subagent / excluded sessions
      await writeSession('subagent-artifacts/child.jsonl', 'sub-1', '/work/repo-a/server', { parentSession: 's1' })
      await writeSession('repo-a/subagents/run-0.jsonl', 'sub-2', '/work/repo-a/server')
      await writeSession('11111111-1111-4111-8111-111111111111/run-0/session.jsonl', 'run-0', '/work/repo-a/server')
      await writeSession('repo-a/run_transcript.jsonl', 'mirror', '/work/repo-a/server')
      await writeSession('events.jsonl', 'events', '/work/repo-a/server')

      const result = await discoverSessionCatalog(root, '/work/repo-b/server')

      expect(result.sessions.map((s) => s.id).sort()).toEqual(['forked', 'mirror', 's1', 's2', 's3', 's4'])
      expect(result.projects).toHaveLength(3)

      const repoA = result.projects.find((p) => p.cwd === '/work/repo-a/server')
      const repoB = result.projects.find((p) => p.cwd === '/work/repo-b/server')
      const client = result.projects.find((p) => p.cwd === '/work/client')

      expect(repoA?.count).toBe(4)
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

      const nested = await discoverSessionCatalog(path.join(root, 'repo-a'))
      expect(nested.sessions.map((s) => s.relativePath).sort()).toEqual(['forked.jsonl', 'run_transcript.jsonl', 'session-1.jsonl', 'session-2.jsonl'])
      expect(nested.sessions.every((s) => s.projectName === 'server')).toBe(true)
      expect(result.sessions.find((s) => s.id === 's1')?.projectName).toBe('repo-a/server')
      const refreshed = await discoverSessionCatalog(root)
      expect(refreshed.sessions.find((s) => s.id === 's1')?.projectName).toBe('repo-a/server')
    })
  })
})
