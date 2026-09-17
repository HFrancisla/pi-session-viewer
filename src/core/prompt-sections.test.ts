import { describe, expect, it } from 'vitest'
import { parseSystemPromptSections } from './prompt-sections'
import type { SystemPromptComposition } from './types'

describe('parseSystemPromptSections', () => {
  it('correctly splits standard Pi system prompt into all 8 sections and includes char counts in meta', () => {
    const prompt = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute commands
- edit: Edit files
- write: Write files

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Be concise in your responses
- Show file paths clearly when working with files

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /docs/README.md
- Additional docs: /docs
- Examples: /examples
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)

Keep evidence concise.

<project_context>
Project-specific instructions and guidelines:

<project_instructions path="/work/demo/AGENTS.md">
Use tests first.
</project_instructions>
</project_context>

The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.

<available_skills>
  <skill>
    <name>tdd</name>
    <description>Test-driven development</description>
    <location>/skills/tdd/SKILL.md</location>
  </skill>
</available_skills>

Current working directory: /work/demo`

    const composition: SystemPromptComposition = {
      selectedTools: ['read', 'bash', 'edit', 'write'],
      toolSnippets: {
        read: 'Read file contents',
        bash: 'Execute commands',
        edit: 'Edit files',
        write: 'Write files',
      },
      promptGuidelines: ['Be concise in your responses', 'Show file paths clearly when working with files'],
      appendSystemPrompt: 'Keep evidence concise.',
      cwd: '/work/demo',
      contextFiles: [{ path: '/work/demo/AGENTS.md', content: 'Use tests first.' }],
      skills: [{
        name: 'tdd',
        description: 'Test-driven development',
        filePath: '/skills/tdd/SKILL.md',
      }],
    }

    const sections = parseSystemPromptSections(prompt, composition)

    expect(sections.baseTemplate.content).toContain('You are an expert coding assistant')
    expect(sections.baseTemplate.meta).toBe(`默认模板, ${sections.baseTemplate.charCount.toLocaleString('zh-CN')} 字符`)
    expect(sections.baseTemplate.charCount).toBeGreaterThan(0)
    expect(sections.baseTemplate.estimatedTokens).toBeGreaterThan(0)
    expect(sections.baseTemplate.isEmpty).toBe(false)

    expect(sections.availableTools.content).toContain('Available tools:\n- read: Read file contents')
    expect(sections.availableTools.meta).toBe(`4 个工具, ${sections.availableTools.charCount.toLocaleString('zh-CN')} 字符`)
    expect(sections.availableTools.isEmpty).toBe(false)

    expect(sections.guidelines.content).toContain('Guidelines:\n- Be concise')
    expect(sections.guidelines.meta).toBe(`2 条规则, ${sections.guidelines.charCount.toLocaleString('zh-CN')} 字符`)
    expect(sections.guidelines.isEmpty).toBe(false)

    expect(sections.documentation.content).toContain('Pi documentation (read only')
    expect(sections.documentation.meta).toBe(`内置文档, ${sections.documentation.charCount.toLocaleString('zh-CN')} 字符`)
    expect(sections.documentation.isEmpty).toBe(false)

    expect(sections.appendPrompt.content).toBe('Keep evidence concise.')
    expect(sections.appendPrompt.meta).toBe(`有内容, ${sections.appendPrompt.charCount.toLocaleString('zh-CN')} 字符`)
    expect(sections.appendPrompt.isEmpty).toBe(false)

    expect(sections.projectContext.content).toContain('<project_context>')
    expect(sections.projectContext.content).toContain('Use tests first.')
    expect(sections.projectContext.meta).toBe(`1 个文件, ${sections.projectContext.charCount.toLocaleString('zh-CN')} 字符`)
    expect(sections.projectContext.isEmpty).toBe(false)

    expect(sections.skills.content).toContain('<available_skills>')
    expect(sections.skills.meta).toBe(`1 个 skills, ${sections.skills.charCount.toLocaleString('zh-CN')} 字符`)
    expect(sections.skills.isEmpty).toBe(false)

    expect(sections.cwd.content).toBe('Current working directory: /work/demo')
    expect(sections.cwd.meta).toBe(`${sections.cwd.charCount.toLocaleString('zh-CN')} 字符`)
    expect(sections.cwd.isEmpty).toBe(false)
  })

  it('correctly splits demo prompt without docs, append or skills', () => {
    const demoPrompt = `You are an expert coding assistant.\n\nAvailable tools:\n- bash: Execute commands\n\nGuidelines:\n- Be concise\n\n<project_context>\n<project_instructions path="/work/demo/AGENTS.md">\nUse tests first.\n</project_instructions>\n</project_context>\n\nCurrent working directory: /work/demo`
    const composition: SystemPromptComposition = {
      selectedTools: ['bash'],
      toolSnippets: { bash: 'Execute commands' },
      promptGuidelines: ['Be concise'],
      cwd: '/work/demo',
      contextFiles: [{ path: '/work/demo/AGENTS.md', content: 'Use tests first.' }],
      skills: [],
    }

    const sections = parseSystemPromptSections(demoPrompt, composition)

    expect(sections.baseTemplate.content).toBe('You are an expert coding assistant.')
    expect(sections.baseTemplate.meta).toContain('默认模板, ')
    expect(sections.baseTemplate.meta).toContain('字符')

    expect(sections.availableTools.content).toBe('Available tools:\n- bash: Execute commands')
    expect(sections.availableTools.meta).toContain('1 个工具, ')
    expect(sections.availableTools.meta).toContain('字符')

    expect(sections.guidelines.content).toBe('Guidelines:\n- Be concise')
    expect(sections.guidelines.meta).toContain('1 条规则, ')
    expect(sections.guidelines.meta).toContain('字符')

    expect(sections.documentation.content).toBe('无')
    expect(sections.documentation.meta).toBe('无')

    expect(sections.appendPrompt.content).toBe('无')
    expect(sections.appendPrompt.meta).toBe('无')

    expect(sections.projectContext.content).toContain('<project_context>')
    expect(sections.projectContext.meta).toContain('1 个文件, ')
    expect(sections.projectContext.meta).toContain('字符')

    expect(sections.skills.content).toBe('无')
    expect(sections.skills.meta).toBe('无')

    expect(sections.cwd.content).toBe('Current working directory: /work/demo')
    expect(sections.cwd.meta).toBe(`${'Current working directory: /work/demo'.length} 字符`)
  })

  it('handles customPrompt mode where tools and docs are empty and displays "无"', () => {
    const prompt = `You are a custom assistant for a specific domain.

Current working directory: /custom/path`

    const composition: SystemPromptComposition = {
      customPrompt: 'You are a custom assistant for a specific domain.',
      selectedTools: [],
      toolSnippets: {},
      promptGuidelines: [],
      cwd: '/custom/path',
      contextFiles: [],
      skills: [],
    }

    const sections = parseSystemPromptSections(prompt, composition)

    expect(sections.baseTemplate.content).toBe('You are a custom assistant for a specific domain.')
    expect(sections.baseTemplate.meta).toBe(`自定义模板, ${sections.baseTemplate.charCount} 字符`)

    expect(sections.availableTools.content).toBe('无')
    expect(sections.availableTools.meta).toBe('无')
    expect(sections.availableTools.isEmpty).toBe(true)

    expect(sections.guidelines.content).toBe('无')
    expect(sections.guidelines.meta).toBe('无')
    expect(sections.guidelines.isEmpty).toBe(true)

    expect(sections.documentation.content).toBe('无')
    expect(sections.documentation.meta).toBe('无')
    expect(sections.documentation.isEmpty).toBe(true)

    expect(sections.appendPrompt.content).toBe('无')
    expect(sections.appendPrompt.meta).toBe('无')
    expect(sections.appendPrompt.isEmpty).toBe(true)

    expect(sections.projectContext.content).toBe('无')
    expect(sections.projectContext.meta).toBe('无')
    expect(sections.projectContext.isEmpty).toBe(true)

    expect(sections.skills.content).toBe('无')
    expect(sections.skills.meta).toBe('无')
    expect(sections.skills.isEmpty).toBe(true)

    expect(sections.cwd.content).toBe('Current working directory: /custom/path')
    expect(sections.cwd.meta).toBe(`${'Current working directory: /custom/path'.length} 字符`)
  })

  it('falls back to composition.cwd with prefix when prompt does not contain cwd text', () => {
    const prompt = `You are an assistant.`
    const composition: Partial<SystemPromptComposition> = {
      cwd: '/fallback/path',
    }
    const sections = parseSystemPromptSections(prompt, composition)
    expect(sections.cwd.content).toBe('Current working directory: /fallback/path')
    expect(sections.cwd.meta).toBe(`${'Current working directory: /fallback/path'.length} 字符`)
    expect(sections.cwd.isEmpty).toBe(false)
  })

  it('handles empty prompt gracefully', () => {
    const sections = parseSystemPromptSections('')
    for (const item of sections.items) {
      expect(item.content).toBe('无')
      expect(item.meta).toBe('无')
      expect(item.isEmpty).toBe(true)
      expect(item.charCount).toBe(0)
      expect(item.estimatedTokens).toBe(0)
    }
  })
})
