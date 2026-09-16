import { describe, expect, it, vi } from 'vitest'
import { fetchSessions } from '../src/web/api'

describe('authenticated session API client', () => {
  it('sends the instance token only in the Authorization header', async () => {
    const fetchMock = vi.fn(async () => Response.json({ root: '/sessions', sessions: [], warnings: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchSessions('secret-token')

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions', {
      cache: 'no-store',
      headers: { Authorization: 'Bearer secret-token' },
    })
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('secret-token')
  })

  it('turns an expired instance token into an actionable panel-closed error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '需要有效的访问令牌。' }, { status: 401 })))

    await expect(fetchSessions('expired-token')).rejects.toThrow('面板服务已关闭或 Pi 已退出')
  })

  it('turns a disconnected server into the same actionable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))

    await expect(fetchSessions('missing-server')).rejects.toThrow('面板服务已关闭或 Pi 已退出')
  })
})
