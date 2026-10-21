import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildVanillaSystemPrompt,
  computeLineDiff,
  formatDiffLineTooltip,
  findPreviousPromptSnapshot,
  resolvePromptDiff,
  type PromptDiffResult,
} from './prompt-diff'
import type { SystemPromptComposition, TimelineEvent } from './types'
import { buildFixturePrompt } from '../../scripts/generate-prompt-fixtures.mjs'
import { PI_PACKAGE_DIR } from '../../tests/helpers/pi-runtime'

interface PromptFixture {
  options: {
    cwd: string
    selectedTools: string[]
    toolSnippets: Record<string, string>
    promptGuidelines: string[]
    appendSystemPrompt: string
    contextFiles: Array<{ path: string; content: string }>
    skills: Array<{ name: string; description: string; filePath: string }>
  }
  prompt: string
}

function loadFixture(name: string): PromptFixture {
  return JSON.parse(readFileSync(path.join('tests', 'fixtures', 'prompts', name), 'utf8')) as PromptFixture
}

function compositionOf(fixture: PromptFixture): Partial<SystemPromptComposition> {
  return {
    selectedTools: fixture.options.selectedTools,
    toolSnippets: fixture.options.toolSnippets,
    promptGuidelines: fixture.options.promptGuidelines,
    appendSystemPrompt: fixture.options.appendSystemPrompt,
    cwd: fixture.options.cwd,
    contextFiles: fixture.options.contextFiles,
    skills: fixture.options.skills,
  }
}

/** A diff is only trustworthy if it can rebuild both sides from the other. */
function expectDiffIsReversible(result: PromptDiffResult): void {
  const rebuiltTarget = result.lines
    .filter((line) => line.type !== 'removed')
    .map((line) => line.text)
    .join('\n')
  const rebuiltBaseline = result.lines
    .filter((line) => line.type !== 'added')
    .map((line) => line.text)
    .join('\n')

  expect(rebuiltTarget).toBe(result.targetPrompt)
  expect(rebuiltBaseline).toBe(result.baselinePrompt)
  expect(result.addedCount).toBe(result.lines.filter((line) => line.type === 'added').length)
  expect(result.removedCount).toBe(result.lines.filter((line) => line.type === 'removed').length)
  expect(result.unchangedCount).toBe(result.lines.filter((line) => line.type === 'unchanged').length)
}

describe('prompt-diff: the vanilla baseline is Pi\'s real vanilla prompt', () => {
  it.each([
    ['legacy-0.85.1', 'legacy'],
    ['current', 'tagged'],
  ] as const)('reproduces the %s vanilla fixture byte-for-byte (%s layout)', (fixtureSet, layout) => {
    const full = loadFixture(`${fixtureSet}-full.json`)
    const vanilla = loadFixture(`${fixtureSet}-vanilla.json`)

    const rebuilt = buildVanillaSystemPrompt(full.prompt, { cwd: full.options.cwd })
    expect(rebuilt).toBe(vanilla.prompt)
    // The baseline must be written in the same layout as the prompt it compares
    // against, otherwise every line would show up as a change.
    expect(rebuilt.includes('<tools>')).toBe(layout === 'tagged')
  })

  it('reproduces the vanilla prompt the installed Pi builds right now', async () => {
    const { prompt, options } = await buildFixturePrompt(PI_PACKAGE_DIR, 'full')
    const { prompt: vanillaPrompt } = await buildFixturePrompt(PI_PACKAGE_DIR, 'vanilla')

    expect(buildVanillaSystemPrompt(prompt, { cwd: options.cwd as string })).toBe(vanillaPrompt)
  })
})

describe('prompt-diff: resolvePromptDiff against real prompts', () => {
  const full = loadFixture('current-full.json')
  const composition = compositionOf(full)

  it('produces a reversible diff whose baseline is Pi vanilla', () => {
    const result = resolvePromptDiff(full.prompt, { composition })

    expect(result.baselineMode).toBe('vanilla')
    expect(result.baselinePrompt).toBe(buildVanillaSystemPrompt(full.prompt, composition))
    expectDiffIsReversible(result)
  })

  it('marks the project context, skills and appended instructions as additions', () => {
    const result = resolvePromptDiff(full.prompt, { composition })
    const added = result.lines.filter((line) => line.type === 'added').map((line) => line.text)

    expect(added).toContain('- Never commit secrets')
    expect(added).toContain('<project_context>')
    expect(added).toContain('Use tests first.')
    expect(added).toContain('Answer in Chinese.')
    expect(added).toContain('    <name>tdd</name>')
  })

  it('keeps the documentation Pi also sends in the baseline out of the diff', () => {
    const result = resolvePromptDiff(full.prompt, { composition })
    const removed = result.lines.filter((line) => line.type === 'removed').map((line) => line.text)

    expect(removed.filter((line) => line.startsWith('- When asked about: extensions'))).toEqual([])
    expect(result.unchangedCount).toBeGreaterThan(10)
  })

  it('uses the previous effective prompt as a reversible incremental baseline', () => {
    const previousPrompt = 'Base prompt\nExisting rule'
    const currentPrompt = `${previousPrompt}\nNewly appended rule`
    const result = resolvePromptDiff(currentPrompt, { previousPrompt }, 'previous')

    expect(result.baselineMode).toBe('previous')
    expect(result.baselinePrompt).toBe(previousPrompt)
    expect(result.lines.filter((line) => line.type === 'added').map((line) => line.text)).toEqual(['Newly appended rule'])
    expectDiffIsReversible(result)
  })

  it('falls back to Vanilla Pi when a previous baseline is unavailable', () => {
    const result = resolvePromptDiff(full.prompt, { composition }, 'previous')

    expect(result.baselineMode).toBe('vanilla')
    expect(result.baselinePrompt).toBe(buildVanillaSystemPrompt(full.prompt, composition))
  })

  it('finds the preceding resolved snapshot and skips missing prompt records', () => {
    const events = [
      { id: 'initial', entryId: 'initial', kind: 'system-prompt', title: 'System prompt', summary: '', content: 'Initial prompt', systemPrompt: { recordType: 'snapshot' }, raw: {} },
      { id: 'missing', entryId: 'missing', kind: 'system-prompt', title: 'System prompt missing', summary: '', content: 'unresolved', systemPrompt: { recordType: 'reference' }, raw: {} },
      { id: 'update', entryId: 'update', kind: 'system-prompt', title: 'System prompt update', summary: '', content: 'Updated prompt', systemPrompt: { recordType: 'snapshot' }, raw: {} },
    ] as TimelineEvent[]

    expect(findPreviousPromptSnapshot(events, 'update')).toBe('Initial prompt')
  })

  it('uses promptBeforeFinalExtensions when available and reversibly diffs against it', () => {
    const beforeExtensions = full.prompt.replace('Answer in Chinese.', 'Answer in English.')
    const result = resolvePromptDiff(
      full.prompt,
      { composition, promptBeforeFinalExtensions: beforeExtensions },
      'before-extensions'
    )

    expect(result.baselineMode).toBe('before-extensions')
    expect(result.baselinePrompt).toBe(beforeExtensions)
    expectDiffIsReversible(result)
  })

  it('falls back to the vanilla baseline when no earlier prompt was recorded', () => {
    const result = resolvePromptDiff(full.prompt, { composition }, 'before-extensions')

    expect(result.baselineMode).toBe('vanilla')
    expectDiffIsReversible(result)
  })
})

describe('computeLineDiff', () => {
  it('returns all unchanged lines when texts are identical', () => {
    const text = 'Line 1\nLine 2\nLine 3'
    const result = computeLineDiff(text, text)

    expect(result.addedCount).toBe(0)
    expect(result.removedCount).toBe(0)
    expect(result.unchangedCount).toBe(3)
    expect(result.lines.map((line) => line.text)).toEqual(['Line 1', 'Line 2', 'Line 3'])
  })

  it('identifies added lines with correct new line numbers', () => {
    const result = computeLineDiff('Line 1\nLine 3', 'Line 1\nLine 2\nLine 3')

    expect(result.addedCount).toBe(1)
    expect(result.removedCount).toBe(0)
    const added = result.lines.find((line) => line.type === 'added')
    expect(added?.text).toBe('Line 2')
    expect(added?.newLineNumber).toBe(2)
    expect(added?.oldLineNumber).toBeUndefined()
  })

  it('identifies removed lines with correct old line numbers', () => {
    const result = computeLineDiff('Line 1\nLine 2\nLine 3', 'Line 1\nLine 3')

    expect(result.removedCount).toBe(1)
    const removed = result.lines.find((line) => line.type === 'removed')
    expect(removed?.text).toBe('Line 2')
    expect(removed?.oldLineNumber).toBe(2)
    expect(removed?.newLineNumber).toBeUndefined()
  })

  it('handles modifications as removed followed by added lines', () => {
    const result = computeLineDiff('Line 1\nold line', 'Line 1\nnew line')
    const types = result.lines.map((line) => line.type)

    expect(types).toEqual(['unchanged', 'removed', 'added'])
    expect(result.addedCount).toBe(1)
    expect(result.removedCount).toBe(1)
  })

  it('handles empty baseline or empty target', () => {
    const added = computeLineDiff('', 'Line 1')
    expect(added.addedCount).toBe(1)
    expect(added.removedCount).toBe(0)

    const removed = computeLineDiff('Line 1', '')
    expect(removed.addedCount).toBe(0)
    expect(removed.removedCount).toBe(1)
  })

  it('formats tooltips with line numbers and side labels', () => {
    const result = computeLineDiff('Line 1\nold', 'Line 1\nnew')
    const added = result.lines.find((line) => line.type === 'added')
    const removed = result.lines.find((line) => line.type === 'removed')

    expect(formatDiffLineTooltip(added!, { current: 'current', baseline: 'baseline' })).toContain('current')
    expect(formatDiffLineTooltip(removed!, { current: 'current', baseline: 'baseline' })).toContain('baseline')
  })
})
