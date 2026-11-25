import type { SystemPromptComposition } from './types'

/**
 * Which wire format the prompt uses.
 *
 * - `tagged`: Pi wraps every section except the preamble in XML-ish
 *   tags (`<tools>`, `<rules>`, `<docs>`, `<addendum>`, `<project_context>`,
 *   `<skills>`, `<cwd>`), joined with blank lines.
 * - `opaque`: the recorded forced prompt exactly matches the effective text;
 *   Pi emits this as raw content, not as structured sections.
 * - `unknown`: non-empty text without recognized section boundaries or proof
 *   that Pi emitted an opaque prompt. This is a validation error.
 */
export type PromptFormat = 'tagged' | 'opaque' | 'unknown' | 'empty'

export interface PromptSectionRange {
  /** Inclusive offset of the first character of the region in the source prompt. */
  start: number
  /** Exclusive offset of the last character of the region in the source prompt. */
  end: number
}

export interface PromptSectionItem {
  id: string
  index: number
  title: string
  meta: string
  content: string
  charCount: number
  estimatedTokens: number
  isEmpty: boolean
  /**
   * Regions of the source prompt this section was built from. Across all items
   * the regions never overlap and cover every non-whitespace character exactly
   * once, which lets tests prove the parser lost and duplicated nothing.
   */
  ranges: PromptSectionRange[]
  /** True when Pi emitted a section this version of the viewer does not model. */
  unrecognized?: boolean
}

export interface UnrecognizedPromptSection {
  name: string
  content: string
  range: PromptSectionRange
}

export interface ParsedPromptSections {
  baseTemplate: PromptSectionItem
  availableTools: PromptSectionItem
  guidelines: PromptSectionItem
  documentation: PromptSectionItem
  appendPrompt: PromptSectionItem
  projectContext: PromptSectionItem
  skills: PromptSectionItem
  cwd: PromptSectionItem
  mcpServers: PromptSectionItem
  items: PromptSectionItem[]
  format: PromptFormat
  /**
   * Pi sections found but not modelled by this viewer. They are still returned
   * as items (with `unrecognized: true`) so content is never hidden; this list
   * exists so a Pi release that adds a section is visible instead of silently
   * absorbed into another section.
   */
  unrecognizedSections: UnrecognizedPromptSection[]
}

type SectionField =
  | 'baseTemplate'
  | 'availableTools'
  | 'guidelines'
  | 'documentation'
  | 'appendPrompt'
  | 'projectContext'
  | 'skills'
  | 'cwd'
  | 'mcpServers'

interface Claim {
  field: SectionField
  /** Region of the source prompt owned by this section, including wrapper tags. */
  start: number
  end: number
  /** Region whose text becomes the section content; defaults to `start`/`end`. */
  contentStart?: number
  contentEnd?: number
  /** Set for Pi sections this viewer does not model. */
  name?: string
}

interface SectionParts {
  texts: string[]
  ranges: PromptSectionRange[]
}

interface ParsedRegions {
  fields: Record<SectionField, SectionParts>
}

const TAG_TO_FIELD: Record<string, SectionField> = {
  tools: 'availableTools',
  rules: 'guidelines',
  docs: 'documentation',
  addendum: 'appendPrompt',
  project_context: 'projectContext',
  skills: 'skills',
  cwd: 'cwd',
  // Provided by Pi's MCP extension; appended after the built-in sections.
  mcp_servers: 'mcpServers',
}

/**
 * Tags Pi (or an extension building a prompt on top of Pi) nests *inside* a
 * section. They are never top-level sections, even when they sit on their own
 * line surrounded by blank lines — for example the `<available_skills>` block
 * inside `<skills>`, or a second one that `pi-subagents` injects into a
 * subagent prompt.
 */
const NESTED_PROMPT_TAGS = new Set([
  'available_skills',
  'skill',
  'subagent',
  'name',
  'description',
  'location',
  'project_instructions',
  'summary',
  'conversation',
  'inline',
  'redacted',
  'unknown',
])

function emptyParts(): SectionParts {
  return { texts: [], ranges: [] }
}

function emptyFields(): Record<SectionField, SectionParts> {
  return {
    baseTemplate: emptyParts(),
    availableTools: emptyParts(),
    guidelines: emptyParts(),
    documentation: emptyParts(),
    appendPrompt: emptyParts(),
    projectContext: emptyParts(),
    skills: emptyParts(),
    cwd: emptyParts(),
    mcpServers: emptyParts(),
  }
}

function countGuidelineLines(text: string): number {
  const matches = text.match(/^\s*-\s+/gm)
  return matches ? matches.length : 0
}

function formatMetaWithChars(label: string, charCount: number): string {
  if (charCount === 0 || label === 'None') {
    return 'None'
  }
  const charText = `${charCount.toLocaleString('en-US')} chars`
  if (!label) {
    return charText
  }
  return `${label}, ${charText}`
}

/** Narrows a region to its first/last non-whitespace character. */
function trimRegion(prompt: string, start: number, end: number): PromptSectionRange | undefined {
  let from = start
  let to = end
  while (from < to && /\s/.test(prompt[from])) from += 1
  while (to > from && /\s/.test(prompt[to - 1])) to -= 1
  if (from >= to) return undefined
  return { start: from, end: to }
}

/**
 * Finds the closing `</name>` that terminates a top-level section.
 *
 * Pi joins sections with a blank line, so a closing tag only terminates a
 * section when it is followed by a blank line or by nothing but trailing
 * whitespace. Inner tags do not qualify: `<available_skills>` ends with
 * `\n</skills>` and `<skill>` with `\n  <skill>`, neither of which is whitespace
 * only, so they stay inside their enclosing section.
 */
function findSectionEnd(prompt: string, name: string, from: number): number | undefined {
  const closing = `\n</${name}>`
  let index = prompt.indexOf(closing, from)
  while (index !== -1) {
    const after = index + closing.length
    if (after === prompt.length || prompt.startsWith('\n\n', after) || /^\s*$/.test(prompt.slice(after))) {
      return index
    }
    index = prompt.indexOf(closing, index + 1)
  }
  return undefined
}

function parseTaggedPrompt(prompt: string): { claims: Claim[]; unrecognized: UnrecognizedPromptSection[] } {
  const claims: Claim[] = []
  const unrecognized: UnrecognizedPromptSection[] = []
  const opener = /(?:^|\n\n)<([a-z][a-z0-9_]*)>\n/g
  let consumedUntil = 0

  for (const match of prompt.matchAll(opener)) {
    const name = match[1]
    if (NESTED_PROMPT_TAGS.has(name)) continue
    const prefixLength = match[0].length - (name.length + 3)
    const blockStart = (match.index ?? 0) + prefixLength
    if (blockStart < consumedUntil) continue

    const contentStart = (match.index ?? 0) + match[0].length
    const contentEnd = findSectionEnd(prompt, name, contentStart)
    if (contentEnd === undefined) continue

    const blockEnd = contentEnd + name.length + 4
    const field = TAG_TO_FIELD[name]
    if (field) {
      claims.push({ field, start: blockStart, end: blockEnd, contentStart, contentEnd })
    } else {
      unrecognized.push({
        name,
        content: prompt.slice(contentStart, contentEnd),
        range: { start: blockStart, end: blockEnd },
      })
      claims.push({ field: 'appendPrompt', start: blockStart, end: blockEnd, name })
    }
    consumedUntil = blockEnd
  }

  return { claims, unrecognized }
}

/**
 * Assigns every character of the prompt to exactly one section: claimed regions
 * go to their section, everything else (the preamble, blank-line separators that
 * are trimmed away, and residual text) becomes the base template when it sits
 * before the tool list and append instructions when it sits after it.
 */
function collectRegions(prompt: string, claims: Claim[], boundary: number): ParsedRegions {
  const fields = emptyFields()
  const sorted = [...claims].sort((a, b) => a.start - b.start)

  let cursor = 0
  const takeGap = (start: number, end: number) => {
    const range = trimRegion(prompt, start, end)
    if (!range) return
    const field: SectionField = range.start >= boundary ? 'appendPrompt' : 'baseTemplate'
    fields[field].texts.push(prompt.slice(range.start, range.end))
    fields[field].ranges.push(range)
  }

  for (const claim of sorted) {
    if (claim.start > cursor) takeGap(cursor, claim.start)
    if (claim.name === undefined) {
      const contentStart = claim.contentStart ?? claim.start
      const contentEnd = claim.contentEnd ?? claim.end
      const text = trimRegion(prompt, contentStart, contentEnd)
      if (text) {
        fields[claim.field].texts.push(prompt.slice(text.start, text.end))
        // The claimed region may be wider than the content (Pi's tagged layout
        // puts `<tools>`/`</tools>` around it); the tags belong to the section.
        fields[claim.field].ranges.push({ start: claim.start, end: claim.end })
      }
    }
    cursor = Math.max(cursor, claim.end)
  }
  if (cursor < prompt.length) takeGap(cursor, prompt.length)

  return { fields }
}

/**
 * Parses the raw system prompt text into structured sections that 1:1 map
 * to the content fed into the LLM, preserving counts/badges from composition if available,
 * and uniformly displaying character counts (with estimated tokens in metadata).
 *
 * 仅按当前 Pi 的标签分区解析，不丢弃任何原始内容。
 * 未被已知分区接纳的文本归入基础模板或附加指令；
 * 未识别的标签单独存入 `unrecognizedSections`，不混入其他分区。
 */
export function parseSystemPromptSections(
  prompt: string | undefined,
  composition?: Partial<SystemPromptComposition>
): ParsedPromptSections {
  const rawPrompt = prompt ?? ''

  let format: PromptFormat
  let claims: Claim[] = []
  let unrecognizedFromTags: UnrecognizedPromptSection[] = []

  if (!rawPrompt.trim()) {
    format = 'empty'
  } else if (composition?.forceSystemPrompt === rawPrompt) {
    format = 'opaque'
  } else {
    const tagged = parseTaggedPrompt(rawPrompt)
    if (tagged.claims.length > 0) {
      format = 'tagged'
      claims = tagged.claims
      unrecognizedFromTags = tagged.unrecognized
    } else {
      format = 'unknown'
    }
  }

  const toolsStart = claims.reduce<number | undefined>(
    (lowest, claim) =>
      claim.field === 'availableTools' && (lowest === undefined || claim.start < lowest) ? claim.start : lowest,
    undefined
  )
  const boundary =
    toolsStart ?? claims.reduce<number>((lowest, claim) => Math.min(lowest, claim.start), rawPrompt.length)

  const unrecognizedSections = unrecognizedFromTags
  const { fields } = collectRegions(rawPrompt, claims, boundary)
  if (format === 'opaque') {
    fields.baseTemplate.texts = [rawPrompt]
    fields.baseTemplate.ranges = [{ start: 0, end: rawPrompt.length }]
  }

  const join = (parts: SectionParts): string => parts.texts.join('\n\n')
  const baseText = join(fields.baseTemplate)
  const appendText = join(fields.appendPrompt)
  const availableTools = join(fields.availableTools)
  const guidelines = join(fields.guidelines)
  const documentation = join(fields.documentation)
  const projectContext = join(fields.projectContext)
  const skillsContent = join(fields.skills)
  const cwdContent = join(fields.cwd)
  const mcpServersContent = join(fields.mcpServers)

  // Composition fallbacks: only used when the prompt itself has no such section.
  const resolvedCwd = cwdContent || (composition?.cwd?.trim() ?? '')
  const resolvedSkills =
    skillsContent ||
    (composition?.skills?.length
      ? composition.skills
          .map((s) => `- ${s.name}: ${s.description}${s.filePath ? ` (${s.filePath})` : ''}`)
          .join('\n')
      : '')

  // Determine metadata labels
  let baseLabel = 'None'
  if (composition?.customPrompt) {
    baseLabel = 'Custom Template'
  } else if (baseText) {
    baseLabel = 'Default Template'
  }

  let guidelinesLabel = 'None'
  const guidelineLines = countGuidelineLines(guidelines)
  const guidelinesCount = guidelineLines > 0 ? guidelineLines : (composition?.promptGuidelines?.length ?? 0)
  if (guidelinesCount > 0) {
    guidelinesLabel = `${guidelinesCount} ${guidelinesCount === 1 ? 'rule' : 'rules'}`
  } else if (guidelines) {
    guidelinesLabel = 'Present'
  }

  const docsLabel = documentation ? 'Built-in Docs' : 'None'
  const appendLabel = appendText ? 'Present' : 'None'

  let contextLabel = 'None'
  const contextFilesCount = composition?.contextFiles?.length ?? 0
  if (contextFilesCount > 0) {
    contextLabel = `${contextFilesCount} ${contextFilesCount === 1 ? 'file' : 'files'}`
  } else if (projectContext) {
    contextLabel = 'Present'
  }

  let mcpServersLabel = 'None'
  // Pi truncates long lists with a `- … N more servers; …` line, which is a notice
  // rather than a server (see the MCP extension's `renderServersSection`).
  const mcpServerCount = mcpServersContent
    .split('\n')
    .filter((line) => /^- /.test(line) && !line.startsWith('- …')).length
  if (mcpServerCount > 0) {
    mcpServersLabel = `${mcpServerCount} ${mcpServerCount === 1 ? 'server' : 'servers'}`
  } else if (mcpServersContent) {
    mcpServersLabel = 'Present'
  }

  let skillsLabel = 'None'
  const skillsCount = composition?.skills?.length ?? 0
  if (skillsCount > 0) {
    skillsLabel = `${skillsCount} skills`
  } else if (resolvedSkills) {
    skillsLabel = 'Present'
  }

  const buildItem = (
    id: string,
    index: number,
    title: string,
    content: string,
    label: string,
    parts: SectionParts
  ): PromptSectionItem => ({
    id,
    index,
    title,
    meta: formatMetaWithChars(label, content.length),
    content: content || 'None',
    charCount: content.length,
    estimatedTokens: Math.ceil(content.length / 4),
    isEmpty: !content,
    ranges: parts.ranges,
  })

  const baseTemplateItem = buildItem('base-template', 1, 'Base Template', baseText, baseLabel, fields.baseTemplate)
  const availableToolsItem = buildItem('available-tools', 2, 'Available Tools', availableTools, '', fields.availableTools)
  const guidelinesItem = buildItem('guidelines', 3, 'Guidelines', guidelines, guidelinesLabel, fields.guidelines)
  const documentationItem = buildItem(
    'documentation',
    4,
    'System Documentation',
    documentation,
    docsLabel,
    fields.documentation
  )
  const appendPromptItem = buildItem('append-prompt', 5, 'Append Instructions', appendText, appendLabel, fields.appendPrompt)
  const projectContextItem = buildItem(
    'project-context',
    6,
    'Project Context',
    projectContext,
    contextLabel,
    fields.projectContext
  )
  // Composition fallbacks are not part of the prompt, so those items carry no ranges.
  const skillsItem = buildItem('skills', 7, 'Skills', resolvedSkills, skillsLabel, skillsContent ? fields.skills : emptyParts())
  const cwdItem = buildItem('cwd', 8, 'Working Directory', resolvedCwd, '', cwdContent ? fields.cwd : emptyParts())
  // Pi's own section order puts extension-provided sections last, after cwd.
  const mcpServersItem = buildItem(
    'mcp-servers',
    9,
    'MCP Servers',
    mcpServersContent,
    mcpServersLabel,
    fields.mcpServers
  )

  const items = [
    baseTemplateItem,
    availableToolsItem,
    guidelinesItem,
    documentationItem,
    appendPromptItem,
    projectContextItem,
    skillsItem,
    cwdItem,
    mcpServersItem,
  ]

  for (const section of unrecognizedSections) {
    items.push({
      id: `section:${section.name}`,
      index: items.length + 1,
      title: section.name,
      meta: formatMetaWithChars('Unrecognized', section.content.length),
      content: section.content || 'None',
      charCount: section.content.length,
      estimatedTokens: Math.ceil(section.content.length / 4),
      isEmpty: !section.content,
      ranges: [section.range],
      unrecognized: true,
    })
  }

  return {
    baseTemplate: baseTemplateItem,
    availableTools: availableToolsItem,
    guidelines: guidelinesItem,
    documentation: documentationItem,
    appendPrompt: appendPromptItem,
    projectContext: projectContextItem,
    skills: skillsItem,
    cwd: cwdItem,
    mcpServers: mcpServersItem,
    items,
    format,
    unrecognizedSections,
  }
}
