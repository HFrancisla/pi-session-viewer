import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PI_DEFAULT_PREAMBLE,
  PI_DEFAULT_TOOLS,
  PI_EXTENSION_SECTION_NAMES,
  PI_SECTION_TAG_NAMES,
  PI_TOOL_PROMPT_CONTRIBUTIONS,
  buildPiRules,
} from '../src/core/pi-defaults'
import { FALLBACK_DOCS } from '../src/core/prompt-diff'
import { parseSystemPromptSections } from '../src/core/prompt-sections'
import { buildFixturePrompt } from '../scripts/generate-prompt-fixtures.mjs'
import {
  PI_PACKAGE_DIR,
  PI_VERSION,
  importPiInternal,
  loadPiSystemPrompt,
  loadPiToolContributions,
  normalizePiPackagePaths,
} from './helpers/pi-runtime'
import { expectFullCoverage, expectGroundTruthMapped } from './helpers/prompt-assertions'

interface PromptFixture {
  generatedFrom: string
  variant: 'full' | 'vanilla'
  options: Parameters<typeof expectGroundTruthMapped>[1]
  prompt: string
}

function loadFixture(name: string): PromptFixture {
  return JSON.parse(readFileSync(path.join('tests', 'fixtures', 'prompts', name), 'utf8')) as PromptFixture
}

const LEGACY_FIXTURE = 'legacy-0.85.1-full.json'
const CURRENT_FIXTURE = 'current-full.json'

describe('Pi contract: the viewer copies of Pi prompt data', () => {
  it("matches Pi's built-in tool snippets and guidelines", async () => {
    const real = await loadPiToolContributions()
    expect(Object.keys(real).length).toBeGreaterThan(0)
    for (const [name, contribution] of Object.entries(real)) {
      expect(PI_TOOL_PROMPT_CONTRIBUTIONS[name], `missing copied contribution for tool ${name}`).toBeDefined()
      expect(PI_TOOL_PROMPT_CONTRIBUTIONS[name].snippet).toBe(contribution.snippet)
      expect(PI_TOOL_PROMPT_CONTRIBUTIONS[name].guidelines).toEqual(contribution.guidelines)
    }
  })

  it("matches Pi's default tool selection and preamble", async () => {
    const systemPrompt = await loadPiSystemPrompt()
    if (typeof systemPrompt.normalizeBuildSystemPromptOptions === 'function') {
      const normalized = systemPrompt.normalizeBuildSystemPromptOptions({})
      expect(normalized.selectedTools).toEqual([...PI_DEFAULT_TOOLS])
    }
    const prompt = systemPrompt.buildSystemPrompt({ cwd: '/work/demo' })
    expect(prompt).toContain(PI_DEFAULT_PREAMBLE)
  })

  it("models every section Pi's builder emits for standard options", async () => {
    const systemPrompt = await loadPiSystemPrompt()
    const { options } = await buildFixturePrompt(PI_PACKAGE_DIR, 'full')
    const sections = systemPrompt.buildSystemPromptSections(options as Record<string, unknown>)
    const emitted = Object.keys(sections).filter((name) => name !== 'preamble')

    // A new or renamed Pi section must be reviewed and modelled (or explicitly
    // reported as unrecognized) instead of passing unnoticed.
    expect([...emitted].sort()).toEqual([...PI_SECTION_TAG_NAMES].sort())
  })

  it("models the section Pi's MCP extension adds", async () => {
    const mcp = await importPiInternal<{ MCP_SERVERS_SECTION: string }>('dist/extensions/mcp/index.js')
    expect([...PI_EXTENSION_SECTION_NAMES]).toEqual([mcp.MCP_SERVERS_SECTION])

    const systemPrompt = await loadPiSystemPrompt()
    const { options, prompt } = await buildFixturePrompt(PI_PACKAGE_DIR, 'mcp')
    const sections = systemPrompt.buildSystemPromptSections(options as Record<string, unknown>)
    const emitted = Object.keys(sections).filter((name) => name !== 'preamble')

    expect([...emitted].sort()).toEqual([...PI_SECTION_TAG_NAMES, ...PI_EXTENSION_SECTION_NAMES].sort())

    const parsed = parseSystemPromptSections(prompt, options as never)
    expect(parsed.mcpServers.isEmpty).toBe(false)
    expect(parsed.mcpServers.content).toBe(options.sections?.[mcp.MCP_SERVERS_SECTION])
    // A modelled extension section must not also be reported as unrecognized.
    expect(parsed.unrecognizedSections).toEqual([])
  })

  it("reproduces Pi's own rules section from the copied guidelines", async () => {    const contributions = await loadPiToolContributions()
    const toolGuidelines = Object.fromEntries(
      PI_DEFAULT_TOOLS.map((name) => [name, contributions[name]?.guidelines ?? []])
    )
    const rules = buildPiRules([...PI_DEFAULT_TOOLS], toolGuidelines, [])
    const { prompt } = await buildFixturePrompt(PI_PACKAGE_DIR, 'vanilla')
    const parsed = parseSystemPromptSections(prompt)
    expect(parsed.guidelines.content.split('\n')).toEqual(rules.map((rule) => `- ${rule}`))
  })
})

describe('Pi contract: the copied documentation text', () => {
  it('matches the documentation section Pi emits', async () => {
    const { prompt } = await buildFixturePrompt(PI_PACKAGE_DIR, 'vanilla')
    const realDocs = parseSystemPromptSections(normalizePiPackagePaths(prompt)).documentation.content
    const ours = FALLBACK_DOCS.split('\n')
    const theirs = realDocs.split('\n')

    expect(theirs).toHaveLength(ours.length)
    for (const [index, line] of ours.entries()) {
      // The three path lines point at Pi's install directory; compare the files.
      if (index >= 1 && index <= 3) continue
      expect(theirs[index], `documentation line ${index + 1} changed in Pi`).toBe(line)
    }
    expect(realDocs).toContain('/README.md')
    expect(realDocs).toContain('/docs')
    expect(realDocs).toContain('/examples (extensions, custom tools, SDK)')
  })
})

describe('Pi contract: committed fixtures come from Pi itself', () => {  it.each([
    ['full', 'current-full.json'],
    ['vanilla', 'current-vanilla.json'],
    ['mcp', 'current-mcp.json'],
  ] as const)('rebuilds the committed %s fixture with the installed Pi (%s)', async (variant, file) => {
    const fixture = loadFixture(file)
    expect(
      fixture.generatedFrom,
      `Installed Pi is ${PI_VERSION} but the fixture was generated from ${fixture.generatedFrom}. ` +
        'Review the parser against the new Pi, then regenerate: npm run fixtures:refresh'
    ).toBe(`@earendil-works/pi-coding-agent@${PI_VERSION}`)

    const { prompt } = await buildFixturePrompt(PI_PACKAGE_DIR, variant)
    expect(prompt).toBe(fixture.prompt)
  })
})

describe('Pi contract: parsing prompts Pi actually builds', () => {
  it.each([
    [LEGACY_FIXTURE, 'legacy'],
    [CURRENT_FIXTURE, 'tagged'],
  ] as const)('parses %s as %s and maps every input to its section', (file, expectedFormat) => {
    const fixture = loadFixture(file)
    const sections = parseSystemPromptSections(fixture.prompt, fixture.options)

    expect(sections.format).toBe(expectedFormat)
    expect(sections.unrecognizedSections).toEqual([])
    expectGroundTruthMapped(sections, fixture.options)
    expectFullCoverage(fixture.prompt, sections)
  })

  it('parses the mcp_servers prompt without treating it as unrecognized', () => {
    const fixture = loadFixture('current-mcp.json')
    const sections = parseSystemPromptSections(fixture.prompt, fixture.options)

    expect(sections.format).toBe('tagged')
    expect(sections.unrecognizedSections).toEqual([])
    expect(sections.mcpServers.content.startsWith('MCP servers whose tools are not declared to you.')).toBe(true)
    expect(sections.mcpServers.meta).toContain('2 servers')
    expectGroundTruthMapped(sections, fixture.options)
    expectFullCoverage(fixture.prompt, sections)
  })

  it("counts the servers Pi lists and not its truncation notice", async () => {
    const mcp = await importPiInternal<{
      MCP_SERVERS_SECTION: string
      renderServersSection(servers: unknown): string | undefined
    }>('dist/extensions/mcp/index.js')
    const systemPrompt = await loadPiSystemPrompt()

    // Enough servers that Pi replaces the tail with "- … N more servers; …".
    const servers = Array.from({ length: 300 }, (_, index) => ({
      entry: { name: `server-${index}`, config: { exposure: 'codemode' }, source: '/work/mcp.json' },
      connection: {},
    }))
    const section = mcp.renderServersSection(servers)
    expect(section, 'Pi rendered no section, so this test would prove nothing').toBeTruthy()
    const omitted = section!.split('\n').find((line) => line.includes('more server'))
    expect(omitted, 'Pi no longer truncates this list; update the test').toBeTruthy()

    const { options } = await buildFixturePrompt(PI_PACKAGE_DIR, 'full')
    const prompt = systemPrompt.buildSystemPrompt({
      ...(options as Record<string, unknown>),
      sections: { [mcp.MCP_SERVERS_SECTION]: section },
    })
    const parsed = parseSystemPromptSections(prompt)

    const listedServers = section!.split('\n').filter((line) => line.startsWith('- mcp__')).length
    expect(parsed.mcpServers.meta).toContain(`${listedServers} servers`)
    expect(parsed.unrecognizedSections).toEqual([])
  })

  it('parses the prompt the installed Pi builds right now', async () => {
    const { prompt, options } = await buildFixturePrompt(PI_PACKAGE_DIR, 'full')
    const sections = parseSystemPromptSections(prompt, options as never)

    expect(sections.format).toBe(prompt.includes('<tools>') ? 'tagged' : 'legacy')
    expectGroundTruthMapped(sections, options as never)
    expectFullCoverage(prompt, sections)
    expect(sections.baseTemplate.content).toBe(PI_DEFAULT_PREAMBLE)
  })
})
