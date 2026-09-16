import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const run = promisify(execFile)
const projectRoot = process.cwd()
const token = 'package-test-token'
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-package-'))
const packRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-session-viewer-tarball-'))
const packDestination = path.join(packRoot, 'pack')
await mkdir(packDestination)
let child
let tarballPath

try {
  const packResult = await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDestination], { cwd: projectRoot })
  const packReport = JSON.parse(packResult.stdout)
  const tarballName = packReport[0]?.filename
  if (typeof tarballName !== 'string') throw new Error('npm pack did not return a tarball filename')
  tarballPath = path.join(packDestination, tarballName)

  await run('npm', ['install', '--prefix', temporaryRoot, '--omit=dev', '--ignore-scripts', '--legacy-peer-deps', tarballPath], {
    cwd: projectRoot,
  })

  const installedRoot = path.join(temporaryRoot, 'node_modules', '@hfrancisla', 'pi-session-viewer')
  const extensionPath = path.join(installedRoot, 'dist', 'extension', 'index.js')
  const standalonePath = path.join(installedRoot, 'dist', 'standalone', 'index.js')
  await access(extensionPath)
  await access(path.join(installedRoot, 'dist', 'web', 'index.html'))

  await run(process.execPath, ['--input-type=module', '-e', `const loaded = await import(${JSON.stringify(pathToFileURL(extensionPath).href)}); if (typeof loaded.default !== 'function') process.exit(1)`])

  child = spawn(process.execPath, [standalonePath], {
    cwd: temporaryRoot,
    env: { ...process.env, PI_CODING_AGENT_SESSION_DIR: path.join(temporaryRoot, 'sessions'), PI_SESSION_VIEWER_TOKEN: token },
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
  const serverUrl = startupLine.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
  if (!serverUrl) throw new Error(`Could not parse standalone server URL from: ${startupLine}`)
  const response = await fetch(`${serverUrl}/api/health`, { headers: { Authorization: `Bearer ${token}` } })
  if (response.status !== 200) throw new Error(`standalone health check failed with status ${response.status}`)
} finally {
  if (child && !child.killed) child.kill('SIGTERM')
  await rm(temporaryRoot, { recursive: true, force: true })
  await rm(packRoot, { recursive: true, force: true })
}
