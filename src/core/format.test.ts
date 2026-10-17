import { describe, expect, it } from 'vitest'
import { truncate } from './format'

/** The output `truncate` must keep producing, written the slow way. */
function reference(value: string, max = 92): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return 'No text content'
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

describe('truncate', () => {
  const cases: Array<[string, number?]> = [
    ['', undefined],
    ['   ', undefined],
    ['\n\t  \r\n', undefined],
    ['hello', undefined],
    ['  hello   world  ', undefined],
    ['a'.repeat(91), undefined],
    ['a'.repeat(92), undefined],
    // Truncation boundary: the cut lands inside a whitespace run.
    [`${'a'.repeat(90)}    b`, undefined],
    // Content that is exactly `max` once collapsed, so no ellipsis is added.
    [`${'a'.repeat(92)}    `, undefined],
    [`${'a'.repeat(92)}    b`, undefined],
    [`a${' '.repeat(200)}b`, 4],
    [`a b${' '.repeat(50)}`, 3],
    ['line one\nline two\nline three', 10],
    ['unicode ✓ 换行\n\t mixed', 12],
    ['\u00a0leading nbsp', 8],
    ['x'.repeat(50), 0],
  ]

  it.each(cases)('matches the whole-string normalization for %j (max %s)', (value, max) => {
    expect(truncate(value, max)).toBe(reference(value, max))
  })

  it('stops reading once the kept prefix is decided', () => {
    // A 10 MB body costs the old implementation a full whitespace scan even though
    // only 92 characters survive. The threshold is calibrated against the slow
    // reference on the same machine, so a loaded CI box cannot make this flaky.
    const huge = `${'word '.repeat(2_000_000)}tail`
    const referenceStarted = performance.now()
    const expected = reference(huge)
    const referenceMs = performance.now() - referenceStarted

    const started = performance.now()
    const result = truncate(huge)
    const elapsed = performance.now() - started

    expect(result).toBe(expected)
    expect(elapsed).toBeLessThan(referenceMs / 4)
  })
})
