import type { SystemPromptComposition } from './types'

export const DEFAULT_TOOL_SNIPPETS: Record<string, string> = {
  read: 'Read file contents',
  bash: 'Execute bash commands (ls, grep, find, etc.)',
  edit: 'Make precise file edits with exact text replacement, including multiple disjoint edits in one call',
  write: 'Create or overwrite files',
  powershell: 'Execute PowerShell commands',
}

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

export type DiffBaselineMode = 'vanilla' | 'before-extensions'

export interface VanillaPromptOptions {
  cwd?: string
  selectedTools?: string[]
  toolSnippets?: Record<string, string>
  documentation?: string
}

/**
 * Builds Pi's native, out-of-the-box system prompt (without project AGENTS.md,
 * skills, custom instructions, or extension-added tools).
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

  const snippets = DEFAULT_TOOL_SNIPPETS

  const visibleTools = tools.filter((name) => Boolean(snippets[name]))
  const toolsList = visibleTools.length > 0
    ? visibleTools.map((name) => `- ${name}: ${snippets[name]}`).join('\n')
    : '(none)'

  const hasGrep = tools.includes('grep')
  const hasFind = tools.includes('find')
  const hasLs = tools.includes('ls')

  const guidelinesList: string[] = []
  const guidelinesSet = new Set<string>()
  const addGuideline = (g: string) => {
    if (guidelinesSet.has(g)) return
    guidelinesSet.add(g)
    guidelinesList.push(g)
  }

  if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
    if (hasBash && hasPowerShell) {
      addGuideline('Use bash or PowerShell for file operations like listing, searching, and finding files')
    } else if (hasPowerShell) {
      addGuideline('Use PowerShell for file operations like listing, searching, and finding files')
    } else {
      addGuideline('Use bash for file operations like ls, rg, find')
    }
  }
  addGuideline('Be concise in your responses')
  addGuideline('Show file paths clearly when working with files')

  const guidelines = guidelinesList.map((g) => `- ${g}`).join('\n')

  // Extract Pi documentation section from prompt if present to preserve exact doc paths
  let documentation = ''
  const docMatch = prompt.match(/(?:^|\n)(Pi documentation \(read only [^\n]*:\n[\s\S]*?)(?=\n\n(?:[A-Z<]|Current working directory:|$))/m)
  if (docMatch) {
    documentation = docMatch[1].trim()
  } else {
    documentation = `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /docs/README.md
- Additional docs: /docs
- Examples: /examples (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`
  }

  let cwd = composition?.cwd
  if (!cwd) {
    const cwdMatch = prompt.match(/(?:^|\n+)Current working directory:\s*([^\n]*)\s*$/)
    if (cwdMatch && cwdMatch[1]) {
      cwd = cwdMatch[1].trim()
    }
  }
  const promptCwd = (cwd ?? '').replace(/\\/g, '/')

  let result = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

${documentation}`

  if (promptCwd) {
    result += `\nCurrent working directory: ${promptCwd}`
  }

  return result
}

/**
 * Computes a line-by-line diff between baseline (old) and target (new).
 */
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
  },
  baselineMode: DiffBaselineMode = 'vanilla'
): PromptDiffResult {
  const hasExtensionsBaseline = Boolean(systemPromptData?.promptBeforeFinalExtensions)
  const effectiveMode: DiffBaselineMode = baselineMode === 'before-extensions' && hasExtensionsBaseline
    ? 'before-extensions'
    : 'vanilla'

  const baselinePrompt = effectiveMode === 'before-extensions' && systemPromptData?.promptBeforeFinalExtensions
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
