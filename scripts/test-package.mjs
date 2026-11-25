import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const run = promisify(execFile)
const projectRoot = process.cwd()
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-package-'))
const packRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-tarball-'))
const packDestination = path.join(packRoot, 'pack')
await mkdir(packDestination)
let child

try {
  await run('npm', ['pack', '--ignore-scripts', '--pack-destination', packDestination], { cwd: projectRoot })
  const tarballs = (await readdir(packDestination)).filter((name) => name.endsWith('.tgz'))
  if (tarballs.length !== 1) throw new Error('Expected exactly one npm package tarball')
  const tarballPath = path.join(packDestination, tarballs[0])

  await run('npm', ['install', '--prefix', temporaryRoot, '--omit=dev', '--omit=peer', '--ignore-scripts', tarballPath], {
    cwd: projectRoot,
  })

  const installedRoot = path.join(temporaryRoot, 'node_modules', '@hfrancisla', 'pi-session-viewer')
  const extensionPath = path.join(installedRoot, 'dist', 'extension', 'index.js')
  const standalonePath = path.join(installedRoot, 'dist', 'standalone', 'index.js')
  const publicFiles = new Set(['package.json', 'README.md', 'README.zh-CN.md', 'LICENSE'])
  const files = (await readdir(installedRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(installedRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  for (const file of [...publicFiles, 'dist/extension/index.js', 'dist/standalone/index.js', 'dist/web/index.html']) {
    if (!files.includes(file)) throw new Error(`Package is missing ${file}`)
  }
  for (const file of files) {
    if (!publicFiles.has(file) && !file.startsWith('dist/')) throw new Error(`Unexpected package file: ${file}`)
  }


  await run(process.execPath, ['--input-type=module', '-e', `const loaded = await import(${JSON.stringify(pathToFileURL(extensionPath).href)}); if (typeof loaded.default !== 'function') process.exit(1)`])

  const env = { ...process.env, PI_CODING_AGENT_SESSION_DIR: path.join(temporaryRoot, 'sessions') }
  delete env.PI_SESSION_VIEWER_TOKEN
  child = spawn(process.execPath, [standalonePath], {
    cwd: temporaryRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const startupLine = await new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk) => {
      output += chunk.toString()
      const line = output.split(/\r?\n/).find((value) => value.includes('http://127.0.0.1:'))
      if (line) resolve(line)
    }
    child.stdout.on('data', onData)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`standalone server exited before startup (${code})`)))
  })
  const startupUrl = startupLine.match(/http:\/\/127\.0\.0\.1:\d+\/#\S+/)?.[0]
  if (!startupUrl) throw new Error('Standalone server did not print an authenticated startup URL')
  const url = new URL(startupUrl)
  const token = new URLSearchParams(url.hash.slice(1)).get('token')
  if (!token || token.length < 43) throw new Error('Standalone server did not generate an access token')
  const unauthorized = await fetch(`${url.origin}/api/health`)
  if (unauthorized.status !== 401) throw new Error('Standalone health endpoint accepts unauthenticated requests')
  const response = await fetch(`${url.origin}/api/health`, { headers: { Authorization: `Bearer ${token}` } })
  if (response.status !== 200) throw new Error(`standalone health check failed with status ${response.status}`)
} finally {
  if (child && !child.killed) child.kill('SIGTERM')
  await rm(temporaryRoot, { recursive: true, force: true })
  await rm(packRoot, { recursive: true, force: true })
}
