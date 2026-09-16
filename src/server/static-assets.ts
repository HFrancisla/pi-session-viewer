import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface StaticAsset {
  body: Buffer
  contentType: string
  cacheControl: string
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function containedFile(root: string, relativePath: string): Promise<{ absolute: string; relative: string } | null> {
  const candidate = path.resolve(root, relativePath)
  try {
    const absolute = await fs.realpath(candidate)
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return null
    const stat = await fs.stat(absolute)
    if (!stat.isFile()) return null
    return { absolute, relative: path.relative(root, absolute) }
  } catch {
    return null
  }
}

export async function readStaticAsset(webRoot: string, requestPath: string): Promise<StaticAsset | null> {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  if (!decodedPath.startsWith('/')) return null

  let root: string
  try {
    root = await fs.realpath(webRoot)
  } catch {
    return null
  }

  const requestedRelative = decodedPath === '/' ? 'index.html' : decodedPath.slice(1)
  const requestedCandidate = path.resolve(root, requestedRelative)
  if (requestedCandidate !== root && !requestedCandidate.startsWith(`${root}${path.sep}`)) return null
  const exactFile = await containedFile(root, requestedRelative)
  let selectedFile = exactFile
  if (!selectedFile && !path.extname(requestedRelative)) {
    try {
      await fs.lstat(requestedCandidate)
      return null
    } catch {
      selectedFile = await containedFile(root, 'index.html')
    }
  }
  if (!selectedFile) return null

  return {
    body: await fs.readFile(selectedFile.absolute),
    contentType: MIME_TYPES[path.extname(selectedFile.relative).toLowerCase()] ?? 'application/octet-stream',
    cacheControl: selectedFile.relative === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
  }
}
