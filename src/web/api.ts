import type { SessionFileResponse, SessionListResponse } from '../core/types'

const PANEL_UNAVAILABLE_ERROR = 'Viewer server is unavailable or Pi has exited. Run /session-viewer on again from Pi.'

async function request(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new Error(PANEL_UNAVAILABLE_ERROR)
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let payload: T & { error?: string }
  try {
    payload = await response.json() as T & { error?: string }
  } catch {
    throw new Error(PANEL_UNAVAILABLE_ERROR)
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error(PANEL_UNAVAILABLE_ERROR)
    throw new Error(payload.error ?? `Request failed (${response.status})`)
  }
  return payload
}

export async function fetchSessions(accessToken: string): Promise<SessionListResponse> {
  return readJson<SessionListResponse>(await request('/api/sessions', {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${accessToken}` },
  }))
}

export async function fetchSession(token: string, accessToken: string): Promise<SessionFileResponse> {
  return readJson<SessionFileResponse>(await request(`/api/sessions/${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${accessToken}` },
  }))
}
