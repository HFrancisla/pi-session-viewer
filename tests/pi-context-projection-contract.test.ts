import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSessionView, parseSessionJsonl } from '../src/core/session-parser'
import type { ContextProjection } from '../src/core/types'
import { computeContextProjections, loadPiContextApi, resetPiContextApiCache } from '../src/server/context-projection'
import { walkSessionFiles } from '../src/server/session-discovery'
import { PI_VERSION } from './helpers/pi-runtime'

/**
 * Context-projection contract.
 *
 * The viewer must never decide for itself what the model saw: `computeContextProjections`
 * has to agree with Pi's own `buildSessionProjection`. These tests use the installed
 * Pi (and real sessions on this machine when present) as the source of truth.
 */

/** Where this machine keeps Pi sessions; the real-data tests are skipped without it. */
const SESSIONS_ROOT = path.join(os.homedir(), '.pi', 'agent', 'sessions')

async function readFixture(name: string): Promise<string> {
  return readFile(path.join('tests', 'fixtures', name), 'utf8')
}

describe(`Pi contract: the projection comes from Pi ${PI_VERSION}`, () => {
  it('loads Pi\'s own buildSessionProjection', async () => {
    resetPiContextApiCache()
    const api = await loadPiContextApi()
    expect(api, 'the installed Pi must expose buildSessionProjection').toBeDefined()
    expect(typeof api?.buildSessionProjection).toBe('function')
  })

  // Skipped (visibly) where no Pi sessions exist, instead of passing vacuously.
  it.skipIf(!existsSync(SESSIONS_ROOT))('agrees with Pi on every branch of every real session it can read', async () => {
    const api = await loadPiContextApi()
    expect(api).toBeDefined()

    const files = await walkSessionFiles(SESSIONS_ROOT)
    expect(files.length, 'this test is skipped without real sessions').toBeGreaterThan(0)
    const sample = files.slice(0, 200)

    let compared = 0
    for (const file of sample) {
      const content = await readFile(file, 'utf8')
      const ours = await computeContextProjections(content, file)
      expect(ours, `${file}: Pi's projection must be available for a real session`).toBeDefined()

      const entries = api!.parseSessionEntries(content)
      const parsed = parseSessionJsonl(content, file)
      for (const branch of parsed.branches) {
        const reference = api!.buildSessionProjection(entries, branch.leafId)
        const referenceExcluded = reference.entries
          .filter(
            (entry) =>
              entry.messages.length === 0 &&
              (entry.sourceEntry.type === 'message' || entry.sourceEntry.type === 'custom_message')
          )
          .map((entry) => entry.sourceEntry.id)
          .sort()

        const projection = ours![branch.leafId]
        expect(projection, `${path.basename(file)} branch ${branch.leafId} missing from our projection`).toBeDefined()
        expect(Object.keys(projection.excluded).sort()).toEqual(referenceExcluded)
        compared += 1
      }
    }
    expect(compared, 'no branch was compared against Pi').toBeGreaterThan(0)
  })
})

describe('context projection: fixture sessions', () => {
  it('marks the entry a context edit removed and leaves its raw record intact', async () => {
    const content = await readFixture('context-edit/session.jsonl')
    const projections = await computeContextProjections(content, 'context-edit/session.jsonl')
    expect(projections).toBeDefined()

    const parsed = parseSessionJsonl(content, 'context-edit/session.jsonl')
    const projection = projections![parsed.currentLeafId!]
    expect(projection).toBeDefined()

    const omitted = Object.entries(projection.excluded).filter(([, exclusion]) => exclusion.state === 'omitted')
    expect(omitted).toHaveLength(1)
    const [entryId, exclusion] = omitted[0]
    expect(exclusion.editId).toBe('ctx-edit')

    // The raw record is untouched: it is in the file and in the timeline, marked.
    expect(parsed.entries.some((entry) => entry.id === entryId)).toBe(true)
    const view = buildSessionView(parsed, parsed.currentLeafId, projection)
    const marked = view.events.filter((event) => event.contextExclusion)
    expect(marked.map((event) => event.entryId)).toEqual([entryId])
    expect(marked[0].contextExclusion).toEqual({ state: 'omitted', editId: 'ctx-edit' })
  })

  it('reports the model-visible message count for the branch', async () => {
    const content = await readFixture('context-edit/session.jsonl')
    const api = await loadPiContextApi()
    const projections = await computeContextProjections(content, 'fixture')
    const parsed = parseSessionJsonl(content, 'fixture')
    const entries = api!.parseSessionEntries(content)
    const reference = api!.buildSessionProjection(entries, parsed.currentLeafId)

    expect(projections![parsed.currentLeafId!].messageCount).toBe(
      reference.entries.reduce((total, entry) => total + entry.messages.length, 0)
    )
  })

  it('excludes nothing when a session has no context edits', async () => {
    // Minimal session without edits: the contract is that our excluded set equals
    // Pi's own set of context-producing entries with no messages (here: empty).
    const content = [
      JSON.stringify({ type: 'session', version: 3, id: 'plain', timestamp: '2026-01-01T10:00:00.000Z', cwd: '/work/demo' }),
      JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T10:00:01.000Z', message: { role: 'user', timestamp: 1767261601000, content: 'hi' } }),
      JSON.stringify({ type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-01T10:00:02.000Z', message: { role: 'assistant', timestamp: 1767261602000, stopReason: 'stop', provider: 'demo', model: 'm', content: [{ type: 'text', text: 'hello' }] } }),
    ].join('\n')

    const api = await loadPiContextApi()
    const projections = await computeContextProjections(content, 'plain')
    expect(projections).toBeDefined()

    const parsed = parseSessionJsonl(content, 'plain')
    const reference = api!.buildSessionProjection(api!.parseSessionEntries(content), parsed.currentLeafId)
    const referenceExcluded = reference.entries
      .filter((entry) => entry.messages.length === 0 && entry.sourceEntry.type === 'message')
      .map((entry) => entry.sourceEntry.id)

    expect(Object.keys(projections![parsed.currentLeafId!].excluded).sort()).toEqual(referenceExcluded.sort())
    expect(referenceExcluded).toEqual([])
  })

  it('is branch relative: the same entry is omitted on one branch only', async () => {
    // demo/demo.jsonl omits `assistant` on its current branch; the older branch
    // still reaches that entry, so it must not be marked there.
    const content = await readFixture('sessions/demo/demo.jsonl')
    const projections = await computeContextProjections(content, 'demo/demo.jsonl')
    const parsed = parseSessionJsonl(content, 'demo/demo.jsonl')
    const current = projections![parsed.currentLeafId!]
    const other = Object.values(projections!).find((projection) => projection.leafId !== parsed.currentLeafId)

    expect(Object.keys(current.excluded)).toEqual(['assistant'])
    expect(other, 'the demo fixture should keep an older branch').toBeDefined()
    expect(Object.keys(other!.excluded)).toEqual([])
  })

  it('shows nothing rather than guessing when Pi is unavailable', async () => {
    const previous = process.argv[1]
    resetPiContextApiCache()
    try {
      // Point the resolver at a directory tree without Pi: it must return
      // undefined so the UI can say "unknown" instead of an empty projection.
      process.argv[1] = path.join(os.tmpdir(), 'not-pi', 'index.js')
      const api = await loadPiContextApi()
      if (api === undefined) {
        const content = await readFixture('context-edit/session.jsonl')
        expect(await computeContextProjections(content, 'fixture')).toBeUndefined()
      }
    } finally {
      process.argv[1] = previous
      resetPiContextApiCache()
    }
  })
})

describe('context projection: units the UI reports', () => {
  it('counts excluded entries per turn, matching the branch summary', async () => {
    // One omitted entry expanding into several events must count once, so the
    // turn note and the branch summary agree.
    const content = [
      JSON.stringify({ type: 'session', version: 3, id: 'units', timestamp: '2026-01-01T10:00:00.000Z', cwd: '/work/demo' }),
      JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T10:00:01.000Z', message: { role: 'user', timestamp: 1767261601000, content: 'go' } }),
      JSON.stringify({
        type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-01T10:00:02.000Z',
        message: {
          role: 'assistant', timestamp: 1767261602000, stopReason: 'error', errorMessage: '502', provider: 'demo', model: 'm',
          content: [
            { type: 'thinking', thinking: 'planning' },
            { type: 'text', text: 'starting' },
            { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'npm test' } },
            { type: 'toolCall', id: 'c2', name: 'bash', arguments: { command: 'npm run build' } },
          ],
        },
      }),
      JSON.stringify({ type: 'context_edit', id: 'e1', parentId: 'a1', timestamp: '2026-01-01T10:00:03.000Z', targetId: 'a1', replacement: null }),
    ].join('\n')

    const projections = await computeContextProjections(content, 'units')
    const parsed = parseSessionJsonl(content, 'units')
    const projection = projections![parsed.currentLeafId!]
    const view = buildSessionView(parsed, parsed.currentLeafId, projection)

    const markedRows = view.events.filter((event) => event.contextExclusion)
    expect(markedRows.length, 'the omitted entry expands into several rows').toBeGreaterThan(1)
    expect(new Set(markedRows.map((event) => event.entryId)).size).toBe(1)

    const excludedEntries = Object.values(projection.excluded).filter((entry) => entry.state === 'omitted').length
    expect(excludedEntries).toBe(1)
    const turnCounts = view.turns.map((turn) => turn.contextExcludedCount ?? 0)
    expect(turnCounts.reduce((total, count) => total + count, 0)).toBe(excludedEntries)
  })
})

describe('context projection: the links the viewer shows', () => {
  it.skipIf(!existsSync(SESSIONS_ROOT))(
    "groups Pi's exclusions by the edit that caused them, on real sessions",
    async () => {
    const api = await loadPiContextApi()
    const files = (await walkSessionFiles(SESSIONS_ROOT)).slice(0, 200)
    let checkedEdits = 0

    for (const file of files) {
      const content = await readFile(file, 'utf8')
      if (!content.includes('"type":"context_edit"')) continue
      const projections = await computeContextProjections(content, file)
      const parsed = parseSessionJsonl(content, file)
      const view = buildSessionView(parsed, parsed.currentLeafId, projections?.[parsed.currentLeafId!])

      // Expected grouping: entries Pi keeps out of context, grouped by their edit.
      const reference = api!.buildSessionProjection(api!.parseSessionEntries(content), parsed.currentLeafId)
      const excluded = new Map<string, string[]>()
      for (const entry of reference.entries) {
        if (entry.messages.length > 0) continue
        const state = (entry.sourceEntry as { type?: string }).type
        if (state !== 'message' && state !== 'custom_message') continue
        const exclusion = projections?.[parsed.currentLeafId!]?.excluded[entry.sourceEntry.id!]
        if (!exclusion?.editId) continue
        excluded.set(exclusion.editId, [...(excluded.get(exclusion.editId) ?? []), entry.sourceEntry.id!])
      }

      for (const event of view.events) {
        if (!event.contextEdit) continue
        checkedEdits += 1
        expect(event.contextEdit.affectedEntryIds).toEqual((excluded.get(event.entryId) ?? []).sort())
        // Every linked target must be resolvable when the projection says it is on
        // the branch: the UI offers a jump, so it has to lead somewhere.
        const targetOnBranch = view.events.some((candidate) => candidate.entryId === event.contextEdit!.targetEntryId)
        expect(event.contextEdit.targetOnBranch).toBe(targetOnBranch)
      }
    }

    expect(checkedEdits, 'no context edit was compared against Pi').toBeGreaterThan(0)
    }
  )

  it('links an edit to the entry Pi keeps out of context, on the fixture', async () => {
    const content = await readFixture('context-edit/session.jsonl')
    const projections = await computeContextProjections(content, 'fixture')
    const parsed = parseSessionJsonl(content, 'fixture')
    const projection = projections![parsed.currentLeafId!]
    const view = buildSessionView(parsed, parsed.currentLeafId, projection)
    const edit = view.events.find((event) => event.entryId === 'ctx-edit')

    expect(edit?.contextEdit).toEqual({
      targetEntryId: 'a-failed',
      targetOnBranch: true,
      affectedEntryIds: ['a-failed'],
    })
    expect(edit?.summary).toContain('我先跑一遍测试')
    // No knock-on entries in this fixture: the failed attempt never ran a tool.
    expect(edit?.content).toContain('Also removed from model context: a-failed')
  })
})

describe('context projection: exclusions the viewer must not invent', () => {
  it('attributes an omission to the edit that caused it', async () => {
    const content = await readFixture('context-edit/session.jsonl')
    const projections = await computeContextProjections(content, 'fixture')
    const projectionsWithEdit: ContextProjection[] = Object.values(projections!)

    for (const projection of projectionsWithEdit) {
      for (const exclusion of Object.values(projection.excluded)) {
        if (exclusion.state === 'omitted') {
          expect(exclusion.editId, 'an omission must name its context edit').toBeTruthy()
        } else {
          expect(exclusion.editId, 'a non-edit exclusion must not name an edit').toBeUndefined()
        }
      }
    }
  })
})
