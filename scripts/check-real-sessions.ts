#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { getCurrentSystemMessage } from '@earendil-works/pi-ai/utils/transcript'
import { parseSessionJsonl, getPath } from '../src/core/session-parser'
import { replayBranchState } from '../src/core/native-state'
import { computeContextProjections, loadPiContextApi } from '../src/server/context-projection'
import { discoverSessionCatalog, configuredSessionRoot, walkSessionFiles } from '../src/server/session-discovery'

async function main(): Promise<void> {
  const catalog = await discoverSessionCatalog(configuredSessionRoot())
  const limit = Number(process.env.PI_SESSION_SCAN_LIMIT ?? '2000')
  const files = (await walkSessionFiles(catalog.root)).slice(0, limit)
  const listed = new Set(catalog.sessions.map(session => path.resolve(catalog.root, session.relativePath)))
  const api = await loadPiContextApi()
  let sessions = 0, checked = 0, known = 0, unknown = 0, edits = 0, omitted = 0, ignored = 0
  const failures: string[] = []
  for (const file of files) {
    const relative = path.relative(catalog.root, file)
    try {
      const content = await readFile(file, 'utf8')
      const parsed = parseSessionJsonl(content, relative)
      if (!parsed.header) {
        if (listed.has(file)) failures.push(relative + ': 缺少会话头')
        continue
      }
      if (listed.has(file)) {
        sessions++
        if (parsed.entries.some(entry => entry.type === 'context_edit')) edits++
        for (const warning of parsed.warnings) {
          if (warning.code === 'invalid-json') console.warn(relative + ': ' + warning.message)
          else failures.push(relative + ': ' + warning.message)
        }
        const projections = await computeContextProjections(content, relative)
        const projection = parsed.currentLeafId && projections?.[parsed.currentLeafId]
        if (projection) omitted += Object.values(projection.excluded).filter(item => item.state === 'omitted').length
      }
      ignored += parsed.entries.filter(entry => entry.raw.customType === 'pi-session-viewer.system-prompt').length
      const anchors = new Set([...parsed.branches.map(branch => branch.leafId),
        ...parsed.entries.filter(entry => entry.type === 'compaction' ||
          entry.type === 'message' && (entry.raw.message as {role?:string})?.role === 'system').map(entry => entry.id)])
      if (!api) continue
      const nativeEntries = api.parseSessionEntries(content)
      for (const anchor of anchors) {
        const ours = replayBranchState(getPath(parsed.entries, anchor)).get(anchor)?.state?.message
        const projection = api.buildSessionProjection(nativeEntries, anchor)
        const reference = getCurrentSystemMessage(projection.entries.flatMap(entry => entry.messages) as {role:string}[])
        checked++
        if (ours) known++
        else unknown++
        if (!isDeepStrictEqual(ours, reference)) failures.push(relative + ': 原生重放不一致 @ ' + anchor)
      }
    } catch (error) {
      failures.push(relative + ': ' + String(error))
    }
  }
  console.log(`Scanned ${files.length} session files under ${catalog.root}; Parsed ${sessions} catalog sessions; ${edits} contain context edits; ${omitted} entries omitted by a context edit.`)
  console.log(`Native replay: ${checked} positions compared; ${known} known, ${unknown} unknown. Ignored ${ignored} obsolete Viewer records.`)
  if (!api || !known) console.log('No known native state samples verified.')
  if (failures.length) {
    for (const failure of failures) console.error(failure)
    console.error(`FAIL: ${failures.length} contract or parser violations.`)
    process.exitCode = 1
  } else if (checked && known) console.log('OK: native state replay agrees with Pi projection.')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
