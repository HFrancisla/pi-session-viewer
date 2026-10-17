import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSystemPromptSections } from './prompt-sections'
import type { SystemPromptComposition } from './types'
import { expectFullCoverage, expectGroundTruthMapped } from '../../tests/helpers/prompt-assertions'

interface PromptFixture {
  generatedFrom: string
  variant: 'full' | 'vanilla'
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

const FIXTURES = [
  { file: 'legacy-0.85.1-full.json', format: 'legacy' },
  { file: 'legacy-0.85.1-vanilla.json', format: 'legacy' },
  { file: 'current-full.json', format: 'tagged' },
  { file: 'current-vanilla.json', format: 'tagged' },
  { file: 'current-mcp.json', format: 'tagged' },
] as const

/**
 * These fixtures are produced by Pi's own `buildSystemPrompt()`
 * (see `scripts/generate-prompt-fixtures.mjs`), so no expectation in this file
 * is authored by hand: they assert that the values Pi was given end up in the
 * matching section, for both prompt layouts Pi has shipped.
 */
describe('parseSystemPromptSections: real Pi prompts', () => {
  it.each(FIXTURES)('parses $file ($format layout) without losing or double-counting text', ({ file, format }) => {
    const fixture = loadFixture(file)
    const sections = parseSystemPromptSections(fixture.prompt, fixture.options)

    expect(sections.format).toBe(format)
    expect(sections.unrecognizedSections).toEqual([])
    expectGroundTruthMapped(sections, fixture.options)
    expectFullCoverage(fixture.prompt, sections)
  })
})

describe('parseSystemPromptSections: Pi >= 0.86 tagged layout', () => {
  const fixture = loadFixture('current-full.json')
  const sections = parseSystemPromptSections(fixture.prompt, fixture.options)

  it('returns section content without the surrounding tags', () => {
    expect(sections.availableTools.content).not.toContain('<tools>')
    expect(sections.availableTools.content).not.toContain('</tools>')
    expect(sections.guidelines.content).not.toContain('<rules>')
    expect(sections.documentation.content).not.toContain('<docs>')
    expect(sections.appendPrompt.content).toBe(fixture.options.appendSystemPrompt)
    expect(sections.cwd.content).toBe(fixture.options.cwd)
  })

  it('keeps the whole skills block, hint included, in the Skills section', () => {
    expect(sections.skills.content.startsWith('The following skills provide specialized instructions for specific tasks.')).toBe(true)
    expect(sections.skills.content).toContain('Use the read tool to load a skill')
    expect(sections.skills.content).toContain('<available_skills>')
    expect(sections.skills.content).toContain('</available_skills>')
    // The `<skills>` wrapper is the section delimiter and is not content.
    expect(sections.skills.content).not.toContain('<skills>')
    expect(sections.baseTemplate.content).not.toContain('<available_skills>')
  })

  it('reports the base template as Pi\'s preamble only', () => {
    expect(sections.baseTemplate.content.startsWith('You are an expert coding assistant')).toBe(true)
    expect(sections.baseTemplate.meta).toContain('Default Template')
  })
})

describe('parseSystemPromptSections: the MCP servers section', () => {
  const fixture = loadFixture('current-mcp.json')
  const sections = parseSystemPromptSections(fixture.prompt, fixture.options)

  it('is a modelled section of its own, not an unrecognized block', () => {
    expect(sections.unrecognizedSections).toEqual([])
    const item = sections.items.find((candidate) => candidate.id === 'mcp-servers')
    expect(item?.title).toBe('MCP Servers')
    expect(item?.unrecognized).toBeUndefined()
  })

  it('lists the servers Pi rendered, with a server count', () => {
    expect(sections.mcpServers.content).toContain('- mcp__context7 (codemode)')
    expect(sections.mcpServers.content).toContain('- mcp__dev_radius (tool_search)')
    expect(sections.mcpServers.meta).toContain('2 servers')
    expect(sections.mcpServers.content).not.toContain('<mcp_servers>')
  })

  it('keeps the section last, matching the order Pi appends it in', () => {
    const titles = sections.items.map((item) => item.title)
    expect(titles.at(-1)).toBe('MCP Servers')
    expect(titles).toHaveLength(9)
  })
})

describe('parseSystemPromptSections: Pi <= 0.85 header layout', () => {
  const fixture = loadFixture('legacy-0.85.1-full.json')
  const sections = parseSystemPromptSections(fixture.prompt, fixture.options)

  it('keeps the plain headers in their own sections', () => {
    expect(sections.availableTools.content.startsWith('Available tools:\n')).toBe(true)
    expect(sections.guidelines.content.startsWith('Guidelines:\n')).toBe(true)
    expect(sections.documentation.content.startsWith('Pi documentation (read only')).toBe(true)
  })

  it('separates append instructions from the documentation bullets', () => {
    expect(sections.appendPrompt.content).toBe(fixture.options.appendSystemPrompt)
    expect(sections.documentation.content).not.toContain(fixture.options.appendSystemPrompt)
    expect(sections.documentation.content.endsWith('- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)')).toBe(true)
  })

  it('strips the boilerplate from the working directory', () => {
    expect(sections.cwd.content).toBe(fixture.options.cwd)
  })

  it('strips the project_context wrapper but keeps its content', () => {
    expect(sections.projectContext.content.startsWith('Project-specific instructions and guidelines:')).toBe(true)
    expect(sections.projectContext.content).not.toContain('<project_context>')
    expect(sections.projectContext.content).toContain('<project_instructions path="/work/demo/AGENTS.md">')
  })
})

describe('parseSystemPromptSections: sections the viewer does not model', () => {
  it('surfaces an unknown Pi section instead of absorbing it', () => {
    const prompt = [
      'Preamble text.',
      '<tools>\n- read: Read file contents\n</tools>',
      '<rules>\n- Be concise\n</rules>',
      '<cwd>\n/work/demo\n</cwd>',
      '<my_extension_section>\ncustom extension text\n</my_extension_section>',
    ].join('\n\n')

    const sections = parseSystemPromptSections(prompt)

    expect(sections.format).toBe('tagged')
    expect(sections.unrecognizedSections.map((section) => section.name)).toEqual(['my_extension_section'])
    const extra = sections.items.find((item) => item.id === 'section:my_extension_section')
    expect(extra?.content).toBe('custom extension text')
    expect(extra?.unrecognized).toBe(true)
    // Modelling `mcp_servers` must not start absorbing arbitrary extension sections.
    expect(sections.mcpServers.isEmpty).toBe(true)
    expect(sections.baseTemplate.content).toBe('Preamble text.')
    expectFullCoverage(prompt, sections)
  })

  it('treats mcp_servers as a modelled section, not an unknown one', () => {
    const prompt = [
      'Preamble text.',
      '<cwd>\n/work/demo\n</cwd>',
      '<mcp_servers>\nMCP servers whose tools are not declared to you.\n- mcp__dev-radius (codemode): internal docs\n</mcp_servers>',
    ].join('\n\n')

    const sections = parseSystemPromptSections(prompt)

    expect(sections.unrecognizedSections).toEqual([])
    expect(sections.mcpServers.content).toContain('- mcp__dev-radius (codemode): internal docs')
    expect(sections.mcpServers.meta).toContain('1 server')
    expectFullCoverage(prompt, sections)
  })

  it('flags a prompt whose layout it does not recognize and keeps every character', () => {
    const prompt = 'Totally custom agent prompt.\n\nWith a second paragraph.'
    const sections = parseSystemPromptSections(prompt)

    expect(sections.format).toBe('unknown')
    expect(sections.baseTemplate.content).toBe(prompt)
    expect(sections.availableTools.isEmpty).toBe(true)
    expectFullCoverage(prompt, sections)
  })

  it('treats an empty prompt as empty rather than unknown', () => {
    const sections = parseSystemPromptSections('   ')

    expect(sections.format).toBe('empty')
    for (const item of sections.items) {
      expect(item.isEmpty).toBe(true)
      expect(item.content).toBe('None')
      expect(item.meta).toBe('None')
    }
  })
})

describe('parseSystemPromptSections: composition metadata', () => {
  it('falls back to the recorded cwd and skill list when the prompt omits them', () => {
    const composition: Partial<SystemPromptComposition> = {
      cwd: '/fallback/path',
      skills: [{ name: 'tdd', description: 'Test-driven development', filePath: '/skills/tdd/SKILL.md' }],
    }
    const sections = parseSystemPromptSections('Just a custom prompt.', composition)

    expect(sections.cwd.content).toBe('/fallback/path')
    expect(sections.cwd.ranges).toEqual([])
    expect(sections.skills.content).toBe('- tdd: Test-driven development (/skills/tdd/SKILL.md)')
    expect(sections.skills.ranges).toEqual([])
    expect(sections.skills.meta).toContain('1 skills')
  })

  it('does not show configured append text that never reached the prompt', () => {
    const sections = parseSystemPromptSections('You are an assistant.', {
      appendSystemPrompt: 'Please answer in Chinese.',
    })

    expect(sections.appendPrompt.content).toBe('None')
    expect(sections.appendPrompt.isEmpty).toBe(true)
  })

  it('labels a custom system prompt as a custom template', () => {
    const sections = parseSystemPromptSections('Custom instructions only.', { customPrompt: 'Custom instructions only.' })

    expect(sections.baseTemplate.meta).toContain('Custom Template')
  })

  it('counts the rules the model actually received', () => {
    const prompt = 'Preamble.\n\n<rules>\n- First rule\n- Second rule\n</rules>'
    const sections = parseSystemPromptSections(prompt, { promptGuidelines: ['First rule'] })

    expect(sections.guidelines.meta).toContain('2 rules')
    expect(sections.guidelines.charCount).toBe('- First rule\n- Second rule'.length)
  })
})
