import { describe, expect, it } from 'vitest'
import { disambiguateProjectNames, groupProjects, sessionItemTitle } from '../src/web/components/SessionSidebar'
import type { SessionListItem } from '../src/core/types'

describe('SessionSidebar project disambiguation', () => {
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

  it('groups sessions by unique cwd and provides disambiguated names sorted by latest activity', () => {
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

    const groups = groupProjects(mockSessions)
    expect(groups).toHaveLength(2)

    // repo-a has latest update at 09-12, so it comes first
    expect(groups[0].cwd).toBe('/home/user/repo-a/server')
    expect(groups[0].name).toBe('repo-a/server')
    expect(groups[0].count).toBe(2)

    // repo-b has latest update at 09-11
    expect(groups[1].cwd).toBe('/home/user/repo-b/server')
    expect(groups[1].name).toBe('repo-b/server')
    expect(groups[1].count).toBe(1)
  })

  it('formats session tooltip with exact file name, working directory, and full path', () => {
    const session: SessionListItem = {
      token: 'token123',
      id: 'session-id',
      title: 'Fix issue',
      cwd: '/home/hzf/workspace/agent-projects',
      modifiedAt: '2026-09-16T10:00:00.000Z',
      relativePath: '--home-hzf-workspace-agent-projects--/2026-08-20T05-39-20-410Z_01a01dae.jsonl',
    }

    const title = sessionItemTitle(session, '/home/hzf/.pi/agent/sessions')
    expect(title).toBe(
      '文件：2026-08-20T05-39-20-410Z_01a01dae.jsonl\n' +
      '工作目录：/home/hzf/workspace/agent-projects\n' +
      '完整路径：/home/hzf/.pi/agent/sessions/--home-hzf-workspace-agent-projects--/2026-08-20T05-39-20-410Z_01a01dae.jsonl',
    )
  })
})
