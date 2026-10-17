import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { KNOWN_ENTRY_TYPES, buildSessionView, parseSessionJsonl } from '../src/core/session-parser'
import type { RawObject } from '../src/core/types'
import { PI_PACKAGE_DIR, PI_VERSION } from './helpers/pi-runtime'

/**
 * Entry-shape contract.
 *
 * Pi documents every session entry it writes (with JSON examples) in
 * `docs/session-format.md` inside its own package. This test reads that file from
 * the installed Pi and requires the viewer to model every documented entry type,
 * so a Pi release that adds an entry type fails here instead of showing up as an
 * "Unknown event" row in real sessions.
 */
const DOC_PATH = path.join(PI_PACKAGE_DIR, 'docs', 'session-format.md')

interface DocExample {
  type: string
  line: string
}

function extractJsonExamples(markdown: string): DocExample[] {
  const examples: DocExample[] = []
  for (const block of markdown.matchAll(/```json\n([\s\S]*?)```/g)) {
    for (const line of block[1].split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        // Examples with `...` placeholders are documentation shorthand, not data.
        continue
      }
      if (parsed && typeof parsed === 'object' && typeof (parsed as RawObject).type === 'string') {
        examples.push({ type: (parsed as RawObject).type as string, line: trimmed })
      }
    }
  }
  return examples
}

const DOC = readFileSync(DOC_PATH, 'utf8')
const EXAMPLES = extractJsonExamples(DOC)
/** The `session` header is not an entry: it has no id/parentId and is not in the tree. */
const ENTRY_EXAMPLES = EXAMPLES.filter((example) => example.type !== 'session')
const EXAMPLE_TYPES = [...new Set(ENTRY_EXAMPLES.map((example) => example.type))]

function parseExample(example: DocExample) {
  return parseSessionJsonl(`${example.line}\n`, 'pi-docs example')
}

describe(`Pi contract: session entry types documented by Pi ${PI_VERSION}`, () => {
  it('finds the documented examples (guards against a documentation layout change)', () => {
    expect(EXAMPLES.length).toBeGreaterThan(8)
    expect(EXAMPLE_TYPES).toContain('message')
    expect(EXAMPLE_TYPES).toContain('context_edit')
    expect(EXAMPLE_TYPES).toContain('usage')
  })

  it('models every entry type Pi documents', () => {
    const unmodelled = EXAMPLE_TYPES.filter((type) => !KNOWN_ENTRY_TYPES.has(type))
    expect(
      unmodelled,
      `Pi ${PI_VERSION} documents entry type(s) the parser does not model: ${unmodelled.join(', ')}. ` +
        'Add them to KNOWN_ENTRY_TYPES and give them a title/content in systemEvents().'
    ).toEqual([])
  })

  it("parses Pi's documented examples without unknown-type or invalid-entry warnings", () => {
    for (const example of ENTRY_EXAMPLES) {
      const parsed = parseExample(example)
      const structural = parsed.warnings.filter(
        (warning) => warning.code === 'unknown-type' || warning.code === 'invalid-entry'
      )
      expect(structural, `type "${example.type}" produced ${JSON.stringify(structural)}`).toEqual([])
      expect(parsed.entries.map((entry) => entry.type)).toEqual([example.type])
    }
  })

  it('gives every documented entry type a real timeline title', () => {
    for (const example of ENTRY_EXAMPLES) {
      const view = buildSessionView(parseExample(example))
      const titles = view.events.map((event) => event.title)
      expect(titles.length, `type "${example.type}" produced no events`).toBeGreaterThan(0)
      expect(titles.join(' | '), `type "${example.type}" fell back to an unknown label`).not.toContain('Unknown event:')
    }
  })
})
