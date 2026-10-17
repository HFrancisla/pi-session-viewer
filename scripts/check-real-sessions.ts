#!/usr/bin/env tsx
/**
 * Parses every system prompt the viewer has captured on this machine and reports
 * anything the parser cannot fully explain.
 *
 * This is the check that was missing when Pi switched from plain-text prompt
 * headers to tagged sections: the fixtures showed a green suite while real
 * sessions had already changed shape. Run it after upgrading Pi:
 *
 *   npm run check:sessions
 *
 * Exit code 1 means the parser met a prompt shape it does not model (a new Pi
 * section, or a new layout entirely) — real data, not a fixture.
 */
import { readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseSystemPromptSections, type PromptFormat } from '../src/core/prompt-sections'
import { buildSessionView, parseSessionJsonl } from '../src/core/session-parser'
import { computeContextProjections, loadPiContextApi } from '../src/server/context-projection'
import { walkSessionFiles } from '../src/server/session-discovery'
import type { ParseWarning, SystemPromptComposition } from '../src/core/types'

interface CaptureEntry {
  prompt?: string
  composition?: SystemPromptComposition
  recordType?: string
}

export interface RealSessionFinding {
  session: string
  format: PromptFormat
  promptLength: number
  unrecognized: string[]
  uncovered: string[]
  overlaps: number
}

async function collectSessionFiles(root: string, limit: number): Promise<string[]> {
  const files: string[] = []
  const walk = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= limit) return
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(full)
      }
    }
  }
  await walk(root)
  return files
}

export function inspectPrompt(prompt: string, composition?: SystemPromptComposition): Omit<RealSessionFinding, 'session'> {
  const sections = parseSystemPromptSections(prompt, composition)
  const ranges = sections.items
    .flatMap((item) => item.ranges.map((range) => ({ ...range, id: item.id })))
    .sort((a, b) => a.start - b.start)

  const uncovered: string[] = []
  let overlaps = 0
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) overlaps += 1
    else if (/\S/.test(prompt.slice(cursor, range.start))) uncovered.push(prompt.slice(cursor, range.start))
    cursor = Math.max(cursor, range.end)
  }
  if (/\S/.test(prompt.slice(cursor))) uncovered.push(prompt.slice(cursor))

  return {
    format: sections.format,
    promptLength: prompt.length,
    unrecognized: sections.unrecognizedSections.map((section) => section.name),
    uncovered: uncovered.map((text) => (text.length > 60 ? `${text.slice(0, 60)}…` : text)),
    overlaps,
  }
}

function problemCategories(finding: Omit<RealSessionFinding, 'session'>): string[] {
  const categories: string[] = []
  if (finding.format === 'unknown') categories.push('unknown layout')
  if (finding.unrecognized.length > 0) categories.push(`unknown Pi sections (${finding.unrecognized.join(', ')})`)
  if (finding.uncovered.length > 0) categories.push('unclaimed text')
  if (finding.overlaps > 0) categories.push('overlapping sections')
  return categories
}

function isProblem(finding: Omit<RealSessionFinding, 'session'>): boolean {
  return problemCategories(finding).length > 0
}

async function main(): Promise<void> {
  const root = process.env.PI_CODING_AGENT_SESSION_DIR ?? path.join(os.homedir(), '.pi', 'agent', 'sessions')
  const limit = Number(process.env.PI_SESSION_SCAN_LIMIT ?? '2000')
  // `walkSessionFiles` is the catalog's own rule for "this is a session", so the
  // entry-type checks below cover exactly what the viewer can show.
  const sessionFiles = new Set(await walkSessionFiles(root))
  // Prompt checks additionally cover files the catalog excludes (subagent runs),
  // because their prompts are what exposed earlier layout regressions.
  const files = await collectSessionFiles(root, limit)

  const findings: RealSessionFinding[] = []
  const formats = new Map<PromptFormat, number>()
  const warningCounts = new Map<ParseWarning['code'], number>()
  const structuralWarnings: string[] = []
  const sessionFailures: string[] = []
  let prompts = 0
  let sessions = 0
  let withoutHeader = 0
  let projectedSessions = 0
  let omittedEntries = 0
  let otherExcludedEntries = 0
  let messagesReceived = 0
  let sessionsWithEdits = 0

  for (const file of files) {
    let contents: string
    try {
      contents = await readFile(file, 'utf8')
    } catch {
      continue
    }

    // Run the session parser over real data too, not just the hand-written
    // JSONL fixtures: this is where an unexpected Pi entry shape shows up.
    if (sessionFiles.has(file)) {
      try {
        const parsed = parseSessionJsonl(contents, path.relative(root, file))
        sessions += 1

        // What the model actually received, computed by Pi's own projection.
        if (contents.includes('"type":"context_edit"')) sessionsWithEdits += 1
        const projections = await computeContextProjections(contents, path.relative(root, file))
        if (projections) {
          projectedSessions += 1
          const current = parsed.currentLeafId ? projections[parsed.currentLeafId] : undefined
          if (current) {
            messagesReceived += current.messageCount
            const exclusions = Object.values(current.excluded)
            omittedEntries += exclusions.filter((entry) => entry.state === 'omitted').length
            otherExcludedEntries += exclusions.filter((entry) => entry.state === 'not-in-context').length
          }
        }
        if (!parsed.header) withoutHeader += 1
        for (const warning of parsed.warnings) {
          warningCounts.set(warning.code, (warningCounts.get(warning.code) ?? 0) + 1)
          if (warning.code === 'unknown-type' || warning.code === 'invalid-entry') {
            structuralWarnings.push(`${path.relative(root, file)} line ${warning.line ?? '?'}: ${warning.message}`)
          }
        }
        buildSessionView(parsed)
      } catch (error) {
        sessionFailures.push(`${path.relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const line of contents.split('\n')) {
      if (!line.includes('pi-session-viewer.system-prompt')) continue
      let entry: { customType?: string; data?: CaptureEntry }
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (entry.customType !== 'pi-session-viewer.system-prompt') continue
      const prompt = entry.data?.prompt
      if (typeof prompt !== 'string') continue

      prompts += 1
      const finding = inspectPrompt(prompt, entry.data?.composition)
      formats.set(finding.format, (formats.get(finding.format) ?? 0) + 1)
      if (isProblem(finding)) findings.push({ session: path.relative(root, file), ...finding })
    }
  }

  console.log(`Scanned ${files.length} session files under ${root}`)
  console.log(`Parsed ${sessions} sessions (${withoutHeader} without a header); ${prompts} captured system prompts`)
  console.log(`Layouts: ${[...formats.entries()].map(([format, count]) => `${format}=${count}`).join(', ') || 'none'}`)
  const warningSummary = [...warningCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => `${code}=${count}`)
    .join(', ')
  console.log(`Session parse warnings: ${warningSummary || 'none'}`)
  const projectionApi = await loadPiContextApi()
  if (projectionApi) {
    console.log(
      `Context projection (Pi's own): ${projectedSessions}/${sessions} sessions · ` +
        `${sessionsWithEdits} contain context edits · on the current branch: ` +
        `${omittedEntries} entries omitted by a context edit, ${otherExcludedEntries} excluded for other reasons ` +
        `(compaction, dependent tool results) · ${messagesReceived} messages actually received`
    )
  } else {
    console.log('Context projection: unavailable (Pi could not be loaded from this process)')
  }

  if (structuralWarnings.length > 0) {
    console.error(`\n${structuralWarnings.length} entry shape(s) the parser does not model:\n`)
    for (const warning of structuralWarnings.slice(0, 10)) console.error(`- ${warning}`)
    if (structuralWarnings.length > 10) console.error(`… and ${structuralWarnings.length - 10} more`)
    process.exitCode = 1
  }

  if (sessionFailures.length > 0) {
    console.error(`\n${sessionFailures.length} session(s) could not be parsed:\n`)
    for (const failure of sessionFailures.slice(0, 10)) console.error(`- ${failure}`)
    process.exitCode = 1
  }

  if (findings.length === 0) {
    console.log(sessionFailures.length === 0
      ? 'OK: every captured prompt was fully explained by the parser.'
      : 'OK: every captured prompt was fully explained, but sessions failed to parse above.')
    return
  }

  console.error(`\n${findings.length} prompt(s) the parser could not fully explain\n`)

  const byCategory = new Map<string, RealSessionFinding[]>()
  for (const finding of findings) {
    for (const category of problemCategories(finding)) {
      const bucket = byCategory.get(category) ?? []
      bucket.push(finding)
      byCategory.set(category, bucket)
    }
  }
  for (const [category, matches] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.error(`- ${category}: ${matches.length}`)
    for (const match of matches.slice(0, 3)) {
      console.error(`    ${match.session} (format=${match.format}, ${match.promptLength} chars)`)
      if (match.uncovered.length > 0) {
        console.error(`      first unclaimed text: ${JSON.stringify(match.uncovered[0])}`)
      }
    }
  }
  process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
