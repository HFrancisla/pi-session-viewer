import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { piSessionHeader } from './helpers/pi-session'

const run = (root: string) => promisify(execFile)(process.execPath,
  ['--import', 'tsx', path.resolve('scripts/check-real-sessions.ts')],
  { env: { ...process.env, PI_CODING_AGENT_SESSION_DIR: root, PI_SESSION_SCAN_LIMIT: '20' } })

it('统计原生投影、上下文编辑与工具状态', async () => {
  const { stdout } = await run(path.resolve('tests/fixtures/sessions'))
  expect(stdout).toContain('1 contain context edits')
  expect(stdout).toContain('1 entries omitted by a context edit')
  expect(stdout).toContain('OK: native state replay agrees with Pi projection.')
})

it('旧捕获不参与重放；明确空状态仍是已知状态', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-viewer-native-check-'))
  try {
    const timestamp = '2026-01-01T10:00:00.000Z'
    const file = path.join(root, 'session.jsonl')
    const header = piSessionHeader('session', timestamp, root)
    const old = JSON.stringify({ type:'custom', id:'old', parentId:null, timestamp, customType:'pi-session-viewer.system-prompt', data:{prompt:'ignored'} })
    await writeFile(file, [header,old].join('\n')+'\n')
    expect((await run(root)).stdout).toContain('No known native state samples verified.')
    const native = JSON.stringify({type:'message',id:'native',parentId:'old',timestamp,message:{role:'system',timestamp:1,content:''}})
    await writeFile(file,[header,old,native].join('\n')+'\n')
    const {stdout} = await run(root)
    expect(stdout).toContain('1 known, 0 unknown')
    expect(stdout).toContain('Ignored 1 obsolete Viewer records')
    expect(stdout).toContain('OK: native state replay agrees with Pi projection.')
  } finally { await rm(root,{recursive:true,force:true}) }
})
