import { describe, expect, it } from 'vitest'
import {
  buildVanillaSystemPrompt,
  computeLineDiff,
  formatDiffLineTooltip,
  resolvePromptDiff,
} from './prompt-diff'
import type { SystemPromptComposition } from './types'

describe('prompt-diff', () => {
  describe('computeLineDiff', () => {
    it('returns all unchanged lines when texts are identical', () => {
      const text = 'Line 1\nLine 2\nLine 3'
      const result = computeLineDiff(text, text)

      expect(result.addedCount).toBe(0)
      expect(result.removedCount).toBe(0)
      expect(result.unchangedCount).toBe(3)
      expect(result.lines).toEqual([
        { type: 'unchanged', text: 'Line 1', oldLineNumber: 1, newLineNumber: 1 },
        { type: 'unchanged', text: 'Line 2', oldLineNumber: 2, newLineNumber: 2 },
        { type: 'unchanged', text: 'Line 3', oldLineNumber: 3, newLineNumber: 3 },
      ])
    })

    it('identifies added lines with correct new line numbers', () => {
      const oldText = 'Line 1\nLine 3'
      const newText = 'Line 1\nLine 2\nLine 3'
      const result = computeLineDiff(oldText, newText)

      expect(result.addedCount).toBe(1)
      expect(result.removedCount).toBe(0)
      expect(result.unchangedCount).toBe(2)
      expect(result.lines).toEqual([
        { type: 'unchanged', text: 'Line 1', oldLineNumber: 1, newLineNumber: 1 },
        { type: 'added', text: 'Line 2', newLineNumber: 2 },
        { type: 'unchanged', text: 'Line 3', oldLineNumber: 2, newLineNumber: 3 },
      ])
    })

    it('identifies removed lines with correct old line numbers', () => {
      const oldText = 'Line 1\nLine 2\nLine 3'
      const newText = 'Line 1\nLine 3'
      const result = computeLineDiff(oldText, newText)

      expect(result.addedCount).toBe(0)
      expect(result.removedCount).toBe(1)
      expect(result.unchangedCount).toBe(2)
      expect(result.lines).toEqual([
        { type: 'unchanged', text: 'Line 1', oldLineNumber: 1, newLineNumber: 1 },
        { type: 'removed', text: 'Line 2', oldLineNumber: 2 },
        { type: 'unchanged', text: 'Line 3', oldLineNumber: 3, newLineNumber: 2 },
      ])
    })

    it('handles modifications as removed followed by added lines', () => {
      const oldText = 'A\nOld\nB'
      const newText = 'A\nNew\nB'
      const result = computeLineDiff(oldText, newText)

      expect(result.addedCount).toBe(1)
      expect(result.removedCount).toBe(1)
      expect(result.unchangedCount).toBe(2)
      expect(result.lines).toEqual([
        { type: 'unchanged', text: 'A', oldLineNumber: 1, newLineNumber: 1 },
        { type: 'removed', text: 'Old', oldLineNumber: 2 },
        { type: 'added', text: 'New', newLineNumber: 2 },
        { type: 'unchanged', text: 'B', oldLineNumber: 3, newLineNumber: 3 },
      ])
    })

    it('handles empty baseline or empty target', () => {
      const fromEmpty = computeLineDiff('', 'Line 1\nLine 2')
      expect(fromEmpty.addedCount).toBe(2)
      expect(fromEmpty.removedCount).toBe(0)

      const toEmpty = computeLineDiff('Line 1', '')
      expect(toEmpty.removedCount).toBe(1)
      expect(toEmpty.addedCount).toBe(0)
    })
  })

  describe('buildVanillaSystemPrompt', () => {
    it('builds a vanilla Pi system prompt with standard tools and guidelines', () => {
      const composition: SystemPromptComposition = {
        selectedTools: ['read', 'bash', 'edit', 'write'],
        toolSnippets: {
          read: 'Read file contents',
          bash: 'Execute commands',
          edit: 'Edit files',
          write: 'Write files',
        },
        promptGuidelines: [],
        cwd: '/home/user/project',
        contextFiles: [],
        skills: [],
      }

      const dummyPrompt = 'Pi documentation (read only:\n- Main documentation: /docs\n\nCurrent working directory: /home/user/project'
      const vanilla = buildVanillaSystemPrompt(dummyPrompt, composition)

      expect(vanilla).toContain('You are an expert coding assistant operating inside pi')
      expect(vanilla).toContain('Available tools:\n- read: Read file contents')
      expect(vanilla).toContain('Current working directory: /home/user/project')
      expect(vanilla).not.toContain('<project_context>')
      expect(vanilla).not.toContain('<available_skills>')
    })

    it('produces zero diff when compared against an unmodified vanilla prompt', () => {
      const composition: SystemPromptComposition = {
        selectedTools: ['read', 'bash', 'edit', 'write'],
        toolSnippets: {
          read: 'Read file contents',
          bash: 'Execute bash commands (ls, grep, find, etc.)',
          edit: 'Make precise file edits with exact text replacement, including multiple disjoint edits in one call',
          write: 'Create or overwrite files',
        },
        promptGuidelines: [],
        cwd: '/workspace/demo',
        contextFiles: [],
        skills: [],
      }

      const vanilla = buildVanillaSystemPrompt('', composition)
      const diff = computeLineDiff(vanilla, vanilla)

      expect(diff.addedCount).toBe(0)
      expect(diff.removedCount).toBe(0)
      expect(diff.unchangedCount).toBe(vanilla.split('\n').length)
    })
  })

  describe('resolvePromptDiff', () => {
    const fullCustomPrompt = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call
- write: Create or overwrite files

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Use bash for file operations like ls, rg, find
- Be concise in your responses
- Show file paths clearly when working with files

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /docs/README.md
- Additional docs: /docs
- Examples: /examples (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)

<project_context>
Project-specific instructions and guidelines:

<project_instructions path="/workspace/demo/AGENTS.md">
Custom project rules
</project_instructions>
</project_context>

Current working directory: /workspace/demo`

    it('highlights project context as added lines in vanilla mode', () => {
      const result = resolvePromptDiff(fullCustomPrompt, {
        composition: {
          selectedTools: ['read', 'bash', 'edit', 'write'],
          cwd: '/workspace/demo',
          contextFiles: [{ path: '/workspace/demo/AGENTS.md', content: 'Custom project rules' }],
          skills: [],
          promptGuidelines: [],
          toolSnippets: {},
        },
      }, 'vanilla')

      expect(result.baselineMode).toBe('vanilla')
      expect(result.addedCount).toBeGreaterThan(0)
      expect(result.removedCount).toBe(0)

      const addedLines = result.lines.filter((l) => l.type === 'added').map((l) => l.text)
      expect(addedLines).toContain('<project_context>')
      expect(addedLines).toContain('Custom project rules')
    })

    it('uses promptBeforeFinalExtensions when before-extensions mode is requested and available', () => {
      const promptBeforeExt = 'Prompt before extension modified it'
      const modifiedPrompt = 'Prompt before extension modified it\nExtra instructions from extension'

      const result = resolvePromptDiff(modifiedPrompt, {
        promptBeforeFinalExtensions: promptBeforeExt,
      }, 'before-extensions')

      expect(result.baselineMode).toBe('before-extensions')
      expect(result.addedCount).toBe(1)
      expect(result.removedCount).toBe(0)
      expect(result.lines.find((l) => l.type === 'added')?.text).toBe('Extra instructions from extension')
    })

    it('falls back to vanilla mode if promptBeforeFinalExtensions is missing', () => {
      const result = resolvePromptDiff(fullCustomPrompt, undefined, 'before-extensions')
      expect(result.baselineMode).toBe('vanilla')
    })

    it('marks extension-added tools (websearch, mcp) as added lines in vanilla diff', () => {
      const promptWithExtTools = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call
- write: Create or overwrite files
- websearch: Search the web
- mcp: Run MCP tools

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Use bash for file operations like ls, rg, find
- Be concise in your responses
- Show file paths clearly when working with files

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /docs/README.md
- Additional docs: /docs
- Examples: /examples (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`

      const result = resolvePromptDiff(promptWithExtTools, {
        composition: {
          selectedTools: ['read', 'bash', 'edit', 'write', 'websearch', 'mcp'],
          toolSnippets: {
            websearch: 'Search the web',
            mcp: 'Run MCP tools',
          },
        },
      }, 'vanilla')

      const added = result.lines.filter((l) => l.type === 'added').map((l) => l.text)
      expect(added).toContain('- websearch: Search the web')
      expect(added).toContain('- mcp: Run MCP tools')
    })


    it('formats tooltip with line number and baseline/current indicators', () => {
      const addedLine = { type: 'added' as const, text: 'Hello', newLineNumber: 42 }
      const removedLine = { type: 'removed' as const, text: 'World', oldLineNumber: 15 }
      const unchangedLine = { type: 'unchanged' as const, text: 'Same', newLineNumber: 1, oldLineNumber: 1 }
      const emptyLine = { type: 'unchanged' as const, text: '' }

      // Default labels (Chinese)
      expect(formatDiffLineTooltip(addedLine)).toBe('Line 42 (当前)')
      expect(formatDiffLineTooltip(removedLine)).toBe('Line 15 (基准)')
      expect(formatDiffLineTooltip(unchangedLine)).toBe('Line 1')
      expect(formatDiffLineTooltip(emptyLine)).toBeUndefined()

      // Custom labels (English)
      expect(formatDiffLineTooltip(addedLine, { current: 'Current', baseline: 'Baseline' })).toBe('Line 42 (Current)')
      expect(formatDiffLineTooltip(removedLine, { current: 'Current', baseline: 'Baseline' })).toBe('Line 15 (Baseline)')
      expect(formatDiffLineTooltip(unchangedLine, { current: 'Current', baseline: 'Baseline' })).toBe('Line 1')
    })
  })
})
