import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startSessionHttpServer, type SessionHttpServer } from '../src/server/http-server'
import { encodeSessionToken } from '../src/server/session-discovery'

const servers: SessionHttpServer[] = []
const directories: string[] = []

afterEach(async () => {
  while (servers.length) await servers.pop()?.close()
  while (directories.length) await rm(directories.pop() as string, { recursive: true, force: true })
})

async function createServer(): Promise<SessionHttpServer> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-server-'))
  directories.push(directory)
  return startServerAt(path.join(directory, 'sessions'), 'a'.repeat(64))
}

async function startServerAt(sessionRoot: string, token: string, webFiles: Record<string, string> = {}): Promise<SessionHttpServer> {
  await mkdir(sessionRoot, { recursive: true })
  const webRoot = path.join(path.dirname(sessionRoot), 'web')
  await mkdir(webRoot, { recursive: true })
  for (const [relativePath, content] of Object.entries(webFiles)) {
    const filePath = path.join(webRoot, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
  const server = await startSessionHttpServer({
    sessionRoot,
    webRoot,
    token,
    version: '0.1.0',
  })
  servers.push(server)
  return server
}

async function createServerWithSessions(files: Record<string, string>): Promise<SessionHttpServer> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-server-'))
  directories.push(directory)
  const sessionRoot = path.join(directory, 'sessions')
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(sessionRoot, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
  return startServerAt(sessionRoot, 'b'.repeat(64))
}

async function requestStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    request.once('error', reject)
    request.end()
  })
}

async function requestRawPathStatus(url: string, requestPath: string, headers: Record<string, string> = {}): Promise<number> {
  const parsed = new URL(url)
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: parsed.hostname, port: parsed.port, path: requestPath, headers }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    request.once('error', reject)
    request.end()
  })
}

describe('production session HTTP server security', () => {
  it('rejects API requests without the instance token', async () => {
    const server = await createServer()

    const response = await fetch(`${server.url}/api/health`)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Valid access token required.' })
  })

  it('returns a fixed health payload after authenticating the instance token', async () => {
    const server = await createServer()

    const response = await fetch(`${server.url}/api/health`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', version: '0.1.0' })
  })

  it('rejects authenticated requests addressed through a non-local Host header', async () => {
    const server = await createServer()

    const status = await requestStatus(`${server.url}/api/health`, {
      Authorization: `Bearer ${server.token}`,
      Host: 'evil.example.test',
    })

    expect(status).toBe(403)
  })

  it('rejects authenticated cross-origin API requests', async () => {
    const server = await createServer()

    const status = await requestStatus(`${server.url}/api/health`, {
      Authorization: `Bearer ${server.token}`,
      Origin: 'https://evil.example.test',
    })

    expect(status).toBe(403)
  })

  it('sets restrictive response headers without enabling CORS', async () => {
    const server = await createServer()

    const response = await fetch(`${server.url}/api/health`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })

    expect(response.headers.get('content-security-policy')).toBe("default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('lists only valid Pi sessions and excludes event and subagent sidecars', async () => {
    const session = '{"type":"session","version":3,"id":"session-1","timestamp":"2026-01-01T10:00:00.000Z","cwd":"/work/demo"}\n'
    const server = await createServerWithSessions({
      'nested/session.jsonl': session,
      'events.jsonl': session,
      'nested/run_transcript.jsonl': session,
      'subagent-artifacts/child.jsonl': session,
      'not-a-session.jsonl': '{"type":"message","id":"entry"}\n',
    })

    const response = await fetch(`${server.url}/api/sessions`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })
    const payload = await response.json() as { sessions: Array<{ relativePath: string }> }

    expect(response.status).toBe(200)
    expect(payload.sessions.map((item) => item.relativePath)).toEqual(['nested/session.jsonl'])
  })

  it('reads a listed session by its opaque file token', async () => {
    const content = '{"type":"session","version":3,"id":"session-1","timestamp":"2026-01-01T10:00:00.000Z","cwd":"/work/demo"}\n'
    const server = await createServerWithSessions({ 'nested/session.jsonl': content })

    const response = await fetch(`${server.url}/api/sessions/${encodeSessionToken('nested/session.jsonl')}`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })
    const payload = await response.json() as { relativePath: string; content: string }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ relativePath: 'nested/session.jsonl', content })
  })

  it('rejects a file token that resolves outside the configured session root', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-server-'))
    directories.push(directory)
    const sessionRoot = path.join(directory, 'sessions')
    const content = '{"type":"session","id":"secret"}\n'
    await writeFile(path.join(directory, 'secret.jsonl'), content)
    const server = await startServerAt(sessionRoot, 'c'.repeat(64))

    const response = await fetch(`${server.url}/api/sessions/${encodeSessionToken('../secret.jsonl')}`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })
    const payload = await response.json() as { error: string }

    expect(response.status).toBe(404)
    expect(payload.error).toBe('Requested file is outside allowed directory.')
  })

  it('rejects a session symlink that escapes the configured root', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-server-'))
    directories.push(directory)
    const sessionRoot = path.join(directory, 'sessions')
    await mkdir(sessionRoot, { recursive: true })
    await writeFile(path.join(directory, 'secret.jsonl'), '{"type":"session","id":"secret"}\n')
    await symlink('../secret.jsonl', path.join(sessionRoot, 'escape.jsonl'))
    const server = await startServerAt(sessionRoot, 'd'.repeat(64))

    const response = await fetch(`${server.url}/api/sessions/${encodeSessionToken('escape.jsonl')}`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })
    const payload = await response.json() as { error: string }

    expect(response.status).toBe(404)
    expect(payload.error).toBe('Requested file is outside allowed directory.')
  })

  it('serves the prebuilt SPA entrypoint from the configured web root', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-server-'))
    directories.push(directory)
    const server = await startServerAt(path.join(directory, 'sessions'), 'e'.repeat(64), {
      'index.html': '<!doctype html><title>Pi Session Viewer</title>',
    })

    const response = await fetch(server.url)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('Pi Session Viewer')
  })

  it('allows read-only GET requests only on the API surface', async () => {
    const server = await createServer()

    const response = await fetch(`${server.url}/api/health`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${server.token}` },
    })

    expect(response.status).toBe(405)
  })

  it('does not use SPA fallback for a static path that escapes the web root', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-server-'))
    directories.push(directory)
    await writeFile(path.join(directory, 'secret'), 'not for the web')
    const server = await startServerAt(path.join(directory, 'sessions'), 'g'.repeat(64), {
      'index.html': '<!doctype html><title>viewer</title>',
    })

    const status = await requestRawPathStatus(server.url, '/%2e%2e/secret')

    expect(status).toBe(404)
  })

  it('returns a client error for malformed encoded session tokens', async () => {
    const server = await createServer()

    const status = await requestRawPathStatus(server.url, '/api/sessions/%', {
      Authorization: `Bearer ${server.token}`,
    })

    expect(status).toBe(400)
  })
})
