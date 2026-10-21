import type { SystemPromptComposition, TimelineEvent } from './types'
import { parseSystemPromptSections } from './prompt-sections'
import {
  PI_DEFAULT_PREAMBLE,
  PI_TOOL_PROMPT_CONTRIBUTIONS,
  PI_TOOL_SNIPPETS,
  buildPiRules,
  joinPiPromptParts,
  wrapPiSection,
} from './pi-defaults'

/** Pi's built-in tool snippets. Kept as an alias of the verified copy in `pi-defaults`. */
export const DEFAULT_TOOL_SNIPPETS: Record<string, string> = PI_TOOL_SNIPPETS

export type DiffLineType = 'added' | 'removed' | 'unchanged'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface PromptDiffResult {
  lines: DiffLine[]
  addedCount: number
  removedCount: number
  unchangedCount: number
  baselinePrompt: string
  targetPrompt: string
  baselineMode: DiffBaselineMode
}

export type DiffBaselineMode = 'vanilla' | 'before-extensions' | 'previous'

/** Finds the preceding resolved system-prompt snapshot on the selected branch. */
export function findPreviousPromptSnapshot(events: TimelineEvent[], eventId: string): string | undefined {
  const currentIndex = events.findIndex((event) => event.id === eventId)
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = events[index]
    if (
      candidate.kind === 'system-prompt'
      && candidate.systemPrompt?.recordType !== 'missing'
      && candidate.title !== 'System prompt missing'
      && candidate.title !== 'System prompt unrecorded'
    ) {
      return candidate.content
    }
  }
  return undefined
}

export interface VanillaPromptOptions {
  cwd?: string
  selectedTools?: string[]
  toolSnippets?: Record<string, string>
  documentation?: string
}

const TOOLS_FOOTER =
  'In addition to the tools above, you may have access to other custom tools depending on the project.'

/**
 * Documentation section used when the compared prompt has no docs section.
 * Mirrors Pi's own text; `pi-contract.test.ts` compares it against the docs
 * section Pi really emits, so a reworded bullet fails that test.
 */
export const FALLBACK_DOCS = `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /README.md
- Additional docs: /docs
- Examples: /examples (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`

/**
 * Builds Pi's native, out-of-the-box system prompt (without project AGENTS.md,
 * skills, custom instructions, or extension-added tools).
 *
 * The baseline is emitted in the same layout as `prompt` (Pi's tagged layout for
 * >= 0.86, its header layout for <= 0.85) so the diff compares like with like.
 * `pi-contract.test.ts` asserts this reconstruction against the installed Pi's
 * own `buildSystemPrompt()` output for both layouts, so it cannot silently drift
 * from what Pi actually sends.
 */
export function buildVanillaSystemPrompt(
  prompt: string,
  composition?: Partial<SystemPromptComposition>
): string {
  // Vanilla Pi only includes native core tools out-of-the-box.
  // Extension-added tools (websearch, mcp, etc.) must NOT be in the vanilla baseline
  // so that the diff correctly highlights them as additions.
  const hasPowerShell = composition?.selectedTools?.includes('powershell')
  const hasBash = composition?.selectedTools ? composition.selectedTools.includes('bash') : true

  const tools = hasPowerShell && !hasBash
    ? ['read', 'powershell', 'edit', 'write']
    : ['read', 'bash', 'edit', 'write']

  const toolsList = tools
    .filter((name) => Boolean(PI_TOOL_SNIPPETS[name]))
    .map((name) => `- ${name}: ${PI_TOOL_SNIPPETS[name]}`)
    .join('\n')

  // Keep Pi's exact documentation text (absolute package paths) by taking it
  // from the prompt being compared.
  const parsed = parseSystemPromptSections(prompt)

  // Pi only started feeding tool prompt guidelines into a prompt's rules section
  // after the header layout was gone: the 0.85.1 fixture
  // (`tests/fixtures/prompts/pi-0.85.1-vanilla.json`) contains the file-operations
  // rule and the two standard guidelines but no tool guidelines, while the 1.2.0
  // fixture contains all of them.
  const toolGuidelines = parsed.format === 'legacy'
    ? {}
    : Object.fromEntries(tools.map((name) => [name, PI_TOOL_PROMPT_CONTRIBUTIONS[name]?.guidelines ?? []]))
  const rules = buildPiRules(tools, toolGuidelines, [])
  const documentation = parsed.documentation.content === 'None' ? FALLBACK_DOCS : parsed.documentation.content
  const cwd = (composition?.cwd ?? (parsed.cwd.content === 'None' ? '' : parsed.cwd.content)).replace(/\\/g, '/')

  const toolsBody = `${toolsList}\n\n${TOOLS_FOOTER}`
  const rulesBody = rules.map((rule) => `- ${rule}`).join('\n')

  if (parsed.format === 'legacy') {
    const parts = [
      PI_DEFAULT_PREAMBLE,
      `Available tools:\n${toolsBody}`,
      `Guidelines:\n${rulesBody}`,
      documentation,
    ]
    const base = parts.join('\n\n')
    return cwd ? `${base}\nCurrent working directory: ${cwd}` : base
  }

  const parts = [
    PI_DEFAULT_PREAMBLE,
    wrapPiSection('tools', toolsBody),
    wrapPiSection('rules', rulesBody),
    wrapPiSection('docs', documentation),
  ]
  if (cwd) parts.push(wrapPiSection('cwd', cwd))
  return joinPiPromptParts(parts)
}


export function computeLineDiff(oldText: string, newText: string): {
  lines: DiffLine[]
  addedCount: number
  removedCount: number
  unchangedCount: number
} {
  const oldLines = oldText ? oldText.split('\n') : []
  const newLines = newText ? newText.split('\n') : []

  if (oldText === newText) {
    const lines: DiffLine[] = oldLines.map((text, idx) => ({
      type: 'unchanged',
      text,
      oldLineNumber: idx + 1,
      newLineNumber: idx + 1,
    }))
    return {
      lines,
      addedCount: 0,
      removedCount: 0,
      unchangedCount: lines.length,
    }
  }

  // 1. Common prefix
  let prefixCount = 0
  const maxPrefix = Math.min(oldLines.length, newLines.length)
  while (prefixCount < maxPrefix && oldLines[prefixCount] === newLines[prefixCount]) {
    prefixCount++
  }

  // 2. Common suffix
  let suffixCount = 0
  const maxSuffix = Math.min(oldLines.length - prefixCount, newLines.length - prefixCount)
  while (
    suffixCount < maxSuffix &&
    oldLines[oldLines.length - 1 - suffixCount] === newLines[newLines.length - 1 - suffixCount]
  ) {
    suffixCount++
  }

  const midOld = oldLines.slice(prefixCount, oldLines.length - suffixCount)
  const midNew = newLines.slice(prefixCount, newLines.length - suffixCount)

  // 3. Compute LCS for the middle slice
  const m = midOld.length
  const n = midNew.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (midOld[i - 1] === midNew[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // 4. Backtrack to find diff items
  let i = m
  let j = n
  const midDiff: Array<{ type: DiffLineType; text: string }> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
      midDiff.push({ type: 'unchanged', text: midOld[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      midDiff.push({ type: 'added', text: midNew[j - 1] })
      j--
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      midDiff.push({ type: 'removed', text: midOld[i - 1] })
      i--
    }
  }

  midDiff.reverse()

  // 5. Assemble all lines and assign line numbers
  const allDiff: Array<{ type: DiffLineType; text: string }> = []
  for (let p = 0; p < prefixCount; p++) {
    allDiff.push({ type: 'unchanged', text: oldLines[p] })
  }
  for (const item of midDiff) {
    allDiff.push(item)
  }
  for (let s = oldLines.length - suffixCount; s < oldLines.length; s++) {
    allDiff.push({ type: 'unchanged', text: oldLines[s] })
  }

  let oldLineNum = 1
  let newLineNum = 1
  let addedCount = 0
  let removedCount = 0
  let unchangedCount = 0

  const lines: DiffLine[] = allDiff.map((item) => {
    if (item.type === 'added') {
      addedCount++
      return {
        type: 'added',
        text: item.text,
        newLineNumber: newLineNum++,
      }
    }
    if (item.type === 'removed') {
      removedCount++
      return {
        type: 'removed',
        text: item.text,
        oldLineNumber: oldLineNum++,
      }
    }
    unchangedCount++
    return {
      type: 'unchanged',
      text: item.text,
      oldLineNumber: oldLineNum++,
      newLineNumber: newLineNum++,
    }
  })

  return {
    lines,
    addedCount,
    removedCount,
    unchangedCount,
  }
}

export function formatDiffLineTooltip(
  line: DiffLine,
  labels?: { current?: string; baseline?: string }
): string | undefined {
  const currentLabel = labels?.current ?? '当前'
  const baselineLabel = labels?.baseline ?? '基准'

  if (line.type === 'added') {
    return line.newLineNumber ? `Line ${line.newLineNumber} (${currentLabel})` : undefined
  }
  if (line.type === 'removed') {
    return line.oldLineNumber ? `Line ${line.oldLineNumber} (${baselineLabel})` : undefined
  }
  const lineNum = line.newLineNumber ?? line.oldLineNumber
  return lineNum ? `Line ${lineNum}` : undefined
}

/**
 * Resolves baseline and computes diff for a prompt event.
 */
export function resolvePromptDiff(
  targetPrompt: string,
  systemPromptData?: {
    composition?: Partial<SystemPromptComposition>
    promptBeforeFinalExtensions?: string
    previousPrompt?: string
  },
  baselineMode: DiffBaselineMode = 'vanilla'
): PromptDiffResult {
  const hasExtensionsBaseline = Boolean(systemPromptData?.promptBeforeFinalExtensions)
  const hasPreviousBaseline = systemPromptData?.previousPrompt !== undefined
  const effectiveMode: DiffBaselineMode = baselineMode === 'previous' && hasPreviousBaseline
    ? 'previous'
    : baselineMode === 'before-extensions' && hasExtensionsBaseline
      ? 'before-extensions'
      : 'vanilla'

  const baselinePrompt = effectiveMode === 'previous'
    ? systemPromptData?.previousPrompt ?? ''
    : effectiveMode === 'before-extensions' && systemPromptData?.promptBeforeFinalExtensions
      ? systemPromptData.promptBeforeFinalExtensions
      : buildVanillaSystemPrompt(targetPrompt, systemPromptData?.composition)

  const diff = computeLineDiff(baselinePrompt, targetPrompt)

  return {
    ...diff,
    baselinePrompt,
    targetPrompt,
    baselineMode: effectiveMode,
  }
}
