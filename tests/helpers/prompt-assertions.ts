import { expect } from 'vitest'
import type { ParsedPromptSections } from '../../src/core/prompt-sections'

export interface PromptFixtureOptions {
  cwd: string
  selectedTools: string[]
  toolSnippets: Record<string, string>
  promptGuidelines: string[]
  appendSystemPrompt: string
  contextFiles: Array<{ path: string; content: string }>
  skills: Array<{ name: string; description: string; filePath: string }>
}

/**
 * Every non-whitespace character of the source prompt must belong to exactly one
 * section. This is the invariant that makes the parser's output trustworthy: the
 * sections cannot lose text, duplicate text, or invent boundaries.
 */
export function expectFullCoverage(prompt: string, sections: ParsedPromptSections): void {
  const ranges = sections.items
    .flatMap((item) => item.ranges.map((range) => ({ ...range, id: item.id })))
    .sort((a, b) => a.start - b.start)

  let cursor = 0
  for (const range of ranges) {
    expect(range.start, `section ${range.id} overlaps a previous section`).toBeGreaterThanOrEqual(cursor)
    expect(range.end, `section ${range.id} has an inverted range`).toBeGreaterThan(range.start)
    cursor = range.end
  }

  const covered = ranges.reduce((total, range) => total + (prompt.slice(range.start, range.end).match(/\S/g)?.length ?? 0), 0)
  const totalNonWhitespace = prompt.match(/\S/g)?.length ?? 0
  const uncovered: string[] = []
  let position = 0
  for (const range of ranges) {
    if (range.start > position && /\S/.test(prompt.slice(position, range.start))) {
      uncovered.push(prompt.slice(position, range.start))
    }
    position = range.end
  }
  if (position < prompt.length && /\S/.test(prompt.slice(position))) {
    uncovered.push(prompt.slice(position))
  }

  expect(uncovered, `unclaimed prompt text: ${JSON.stringify(uncovered.slice(0, 3))}`).toEqual([])
  // No section may double-count characters either.
  expect(covered).toBe(totalNonWhitespace)
}

/**
 * Asserts that the values Pi was given for this prompt end up in their own
 * section and nowhere else. The expectations come from the fixture's recorded
 * inputs, so they cannot be satisfied by inventing a layout.
 */
export function expectGroundTruthMapped(sections: ParsedPromptSections, options: PromptFixtureOptions): void {
  const withSnippet = options.selectedTools.filter((name) => options.toolSnippets[name])
  if (withSnippet.length > 0) {
    for (const name of withSnippet) {
      expect(sections.availableTools.content, `tool ${name} missing from Available Tools`).toContain(
        `- ${name}: ${options.toolSnippets[name]}`
      )
    }
    expect(sections.availableTools.isEmpty).toBe(false)
  }

  for (const rule of options.promptGuidelines) {
    expect(sections.guidelines.content, `guideline "${rule}" missing from Guidelines`).toContain(`- ${rule}`)
  }

  if (options.cwd) {
    expect(sections.cwd.content).toBe(options.cwd)
    expect(sections.cwd.content).not.toContain('Current working directory:')
  }

  for (const file of options.contextFiles) {
    expect(sections.projectContext.content, `context file ${file.path} missing`).toContain(`path="${file.path}"`)
    expect(sections.projectContext.content).toContain(file.content)
    expect(sections.projectContext.content).not.toContain('<project_context>')
  }

  for (const skill of options.skills) {
    expect(sections.skills.content, `skill ${skill.name} missing from Skills`).toContain(`<name>${skill.name}</name>`)
  }
  if (options.skills.length > 0) {
    expect(sections.skills.content).toContain(skillProse())
  }

  if (options.appendSystemPrompt) {
    expect(sections.appendPrompt.content).toBe(options.appendSystemPrompt.trim())
  }

  // Section content must not leak into the base template, and the base template
  // must not contain section markup of any layout.
  const base = sections.baseTemplate.content
  for (const name of withSnippet) {
    expect(base, `tool list leaked into Base Template`).not.toContain(`- ${name}:`)
  }
  for (const rule of options.promptGuidelines) {
    expect(base).not.toContain(rule)
  }
  for (const markup of ['<tools>', '<rules>', '<docs>', '<addendum>', '<available_skills>']) {
    expect(base, `Base Template still contains section markup ${markup}`).not.toContain(markup)
  }
  for (const header of ['Available tools:', 'Guidelines:', 'Pi documentation (read only']) {
    expect(base, `Base Template still contains the legacy header "${header}"`).not.toContain(header)
  }
  expect(base).not.toContain('Current working directory:')
}

function skillProse(): string {
  return 'The following skills provide specialized instructions for specific tasks.'
}
