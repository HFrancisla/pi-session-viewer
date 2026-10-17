/**
 * Mirrors Pi's own out-of-the-box system prompt inputs.
 *
 * The viewer runs in the browser, so it cannot import Pi's builder. These
 * constants are therefore a copy of what Pi ships — and `pi-contract.test.ts`
 * asserts this copy against the installed `@earendil-works/pi-coding-agent`
 * package. If Pi changes a snippet, guideline, section name, or prompt layout,
 * that test fails and this file must be updated.
 */

/** Tools Pi enables by default (`normalizeBuildSystemPromptOptions`). */
export const PI_DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'] as const

/** Pi's own standard guidelines, appended after tool guidelines. */
export const PI_STANDARD_GUIDELINES = [
  'Be concise in your responses',
  'Show file paths clearly when working with files',
] as const

export interface PiToolPromptContribution {
  snippet: string
  guidelines: string[]
}

/**
 * `promptSnippet` / `promptGuidelines` from Pi's built-in tool definitions
 * (`dist/core/tools/*.js`).
 */
export const PI_TOOL_PROMPT_CONTRIBUTIONS: Record<string, PiToolPromptContribution> = {
  read: {
    snippet: 'Read file contents',
    guidelines: ['Use read to examine files instead of cat or sed.'],
  },
  bash: {
    snippet: 'Execute bash commands (ls, grep, find, etc.)',
    guidelines: ['You can inspect PI_* environment variables for current model and session details.'],
  },
  edit: {
    snippet: 'Make precise file edits with exact text replacement, including multiple disjoint edits in one call',
    guidelines: [
      'Use edit for precise changes (edits[].oldText must match exactly)',
      'When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls',
      'Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.',
      'Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.',
    ],
  },
  write: {
    snippet: 'Create or overwrite files',
    guidelines: ['Use write only for new files or complete rewrites.'],
  },
  powershell: {
    snippet: 'Execute PowerShell commands',
    guidelines: ['You can inspect PI_* environment variables for current model and session details.'],
  },
  grep: { snippet: 'Search file contents for patterns (respects .gitignore)', guidelines: [] },
  find: { snippet: 'Find files by glob pattern (respects .gitignore)', guidelines: [] },
  ls: { snippet: 'List directory contents', guidelines: [] },
}

export const PI_TOOL_SNIPPETS: Record<string, string> = Object.fromEntries(
  Object.entries(PI_TOOL_PROMPT_CONTRIBUTIONS).map(([name, contribution]) => [name, contribution.snippet])
)

/** The rule Pi adds when a shell tool is selected without grep/find/ls. */
export function piFileOperationsRule(selectedTools: readonly string[]): string | undefined {
  const hasBash = selectedTools.includes('bash')
  const hasPowerShell = selectedTools.includes('powershell')
  if (!hasBash && !hasPowerShell) return undefined
  if (selectedTools.includes('grep') || selectedTools.includes('find') || selectedTools.includes('ls')) return undefined
  if (hasBash && hasPowerShell) {
    return 'Use bash or PowerShell for file operations like listing, searching, and finding files'
  }
  if (hasPowerShell) return 'Use PowerShell for file operations like listing, searching, and finding files'
  return 'Use bash for file operations like ls, rg, find'
}

/**
 * Reproduces Pi's `buildRules`: file-operations rule, then tool guidelines in
 * selection order, then prompt guidelines, then Pi's two standard guidelines,
 * deduplicated in insertion order.
 */
export function buildPiRules(
  selectedTools: readonly string[],
  toolGuidelines: Record<string, string[]>,
  promptGuidelines: readonly string[]
): string[] {
  const rules: string[] = []
  const seen = new Set<string>()
  const add = (rule: string) => {
    const normalized = rule.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    rules.push(normalized)
  }

  const fileOperationsRule = piFileOperationsRule(selectedTools)
  if (fileOperationsRule) add(fileOperationsRule)
  for (const name of selectedTools) for (const rule of toolGuidelines[name] ?? []) add(rule)
  for (const rule of promptGuidelines) add(rule)
  for (const rule of PI_STANDARD_GUIDELINES) add(rule)

  return rules
}

/** Pi's built-in preamble for a default (non-custom) system prompt. */
export const PI_DEFAULT_PREAMBLE =
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.'

/**
 * Pi >= 0.86 wraps every prompt section except the preamble in an XML-style
 * tag of the same name (`buildSystemPromptSections`). Pi <= 0.85 emitted plain
 * headers instead; see `parseSystemPromptSections` for that legacy layout.
 *
 * These are the sections Pi's builder emits for standard options, in order.
 * Extension-provided sections (`PI_EXTENSION_SECTION_NAMES`) are appended after
 * them.
 */
export const PI_SECTION_TAG_NAMES = ['tools', 'rules', 'docs', 'addendum', 'project_context', 'skills', 'cwd'] as const
export type PiSectionTagName = (typeof PI_SECTION_TAG_NAMES)[number]

/**
 * Prompt sections Pi's built-in extensions add through the `sections` option,
 * which `buildSystemPromptSections` appends after the built-in ones.
 * `mcp_servers` is rendered by Pi's MCP extension (`renderServersSection`) and
 * lists the servers whose tools are not declared to the model.
 */
export const PI_EXTENSION_SECTION_NAMES = ['mcp_servers'] as const
export type PiExtensionSectionName = (typeof PI_EXTENSION_SECTION_NAMES)[number]

/** Wraps section content exactly like Pi does. */
export function wrapPiSection(tag: PiSectionTagName | string, content: string): string {
  return `<${tag}>\n${content}\n</${tag}>`
}

/** Joins prompt parts the way Pi's `getSystemMessageText` does. */
export function joinPiPromptParts(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join('\n\n')
}
