import type { SystemPromptComposition } from './types'

export interface PromptSectionItem {
  id: string
  index: number
  title: string
  meta: string
  content: string
  charCount: number
  estimatedTokens: number
  isEmpty: boolean
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
  items: PromptSectionItem[]
}

function countToolLines(text: string): number {
  const matches = text.match(/^\s*-\s+[^:\n]+:/gm)
  return matches ? matches.length : 0
}

function countGuidelineLines(text: string): number {
  const matches = text.match(/^\s*-\s+/gm)
  return matches ? matches.length : 0
}

function formatMetaWithChars(label: string, charCount: number): string {
  if (charCount === 0 || label === '无') {
    return '无'
  }
  const charText = `${charCount.toLocaleString('zh-CN')} 字符`
  if (!label) {
    return charText
  }
  return `${label}, ${charText}`
}

/**
 * Parses the raw system prompt text into structured sections that 1:1 map
 * to the content fed into the LLM, preserving counts/badges from composition if available,
 * and uniformly displaying character counts (with estimated tokens in metadata).
 */
export function parseSystemPromptSections(
  prompt: string | undefined,
  composition?: Partial<SystemPromptComposition>
): ParsedPromptSections {
  const rawPrompt = prompt ?? ''

  let cwdContent = ''
  let promptWithoutCwd = rawPrompt
  const cwdMatch = rawPrompt.match(/(?:^|\n+)Current working directory:\s*([^\n]*)\s*$/)
  if (cwdMatch && cwdMatch.index != null) {
    cwdContent = rawPrompt.slice(cwdMatch.index).trim()
    promptWithoutCwd = rawPrompt.slice(0, cwdMatch.index).trimEnd()
  } else if (composition?.cwd && composition.cwd.trim()) {
    cwdContent = `Current working directory: ${composition.cwd.trim()}`
  }

  let skillsContent = ''
  let promptWithoutSkills = promptWithoutCwd
  const skillsMatch = promptWithoutCwd.match(/(?:^|\n\n)(The following skills provide specialized instructions for specific tasks[\s\S]*|<available_skills>[\s\S]*)$/)
  if (skillsMatch && skillsMatch.index != null) {
    skillsContent = skillsMatch[1].trim()
    promptWithoutSkills = promptWithoutCwd.slice(0, skillsMatch.index).trimEnd()
  } else if (composition?.skills?.length) {
    skillsContent = composition.skills.map((s) => `- ${s.name}: ${s.description}${s.filePath ? ` (${s.filePath})` : ''}`).join('\n')
  }

  let projectContext = ''
  let promptWithoutContext = promptWithoutSkills
  const contextStart = promptWithoutSkills.indexOf('<project_context>')
  if (contextStart !== -1) {
    const contextEnd = promptWithoutSkills.indexOf('</project_context>', contextStart)
    if (contextEnd !== -1) {
      const fullEnd = contextEnd + '</project_context>'.length
      projectContext = promptWithoutSkills.slice(contextStart, fullEnd).trim()
      promptWithoutContext = (promptWithoutSkills.slice(0, contextStart) + promptWithoutSkills.slice(fullEnd)).trim()
    }
  }

  let appendPrompt = ''
  let promptWithoutAppend = promptWithoutContext
  if (composition?.appendSystemPrompt && composition.appendSystemPrompt.trim()) {
    const target = composition.appendSystemPrompt.trim()
    const targetIndex = promptWithoutContext.lastIndexOf(target)
    if (targetIndex !== -1) {
      appendPrompt = target
      promptWithoutAppend = (promptWithoutContext.slice(0, targetIndex) + promptWithoutContext.slice(targetIndex + target.length)).trimEnd()
    } else {
      appendPrompt = target
    }
  } else {
    const docHeaderIndex = promptWithoutAppend.indexOf('Pi documentation (read only')
    if (docHeaderIndex !== -1) {
      const lastDocMarker = '- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)'
      const docEndIndex = promptWithoutAppend.indexOf(lastDocMarker, docHeaderIndex)
      if (docEndIndex !== -1) {
        const afterDocs = promptWithoutAppend.slice(docEndIndex + lastDocMarker.length).trim()
        if (afterDocs) {
          appendPrompt = afterDocs
          promptWithoutAppend = promptWithoutAppend.slice(0, docEndIndex + lastDocMarker.length).trimEnd()
        }
      }
    }
  }

  const toolsMatch = promptWithoutAppend.match(/(?:^|\n+)(Available tools:\n)/)
  const guidelinesMatch = promptWithoutAppend.match(/(?:^|\n+)(Guidelines:\n)/)
  const docsMatch = promptWithoutAppend.match(/(?:^|\n+)(Pi documentation [^\n]*:\n)/)

  let baseTemplate = ''
  let availableTools = ''
  let guidelines = ''
  let documentation = ''

  if (toolsMatch && toolsMatch.index != null) {
    const toolsStart = toolsMatch.index + (toolsMatch[0].length - toolsMatch[1].length)
    baseTemplate = promptWithoutAppend.slice(0, toolsStart).trim()

    const guidelinesStart = guidelinesMatch?.index != null
      ? guidelinesMatch.index + (guidelinesMatch[0].length - guidelinesMatch[1].length)
      : -1

    const docsStart = docsMatch?.index != null
      ? docsMatch.index + (docsMatch[0].length - docsMatch[1].length)
      : -1

    const toolsEnd = guidelinesStart !== -1 ? guidelinesStart : docsStart !== -1 ? docsStart : promptWithoutAppend.length
    availableTools = promptWithoutAppend.slice(toolsStart, toolsEnd).trim()

    if (guidelinesStart !== -1) {
      const guidelinesEnd = docsStart !== -1 ? docsStart : promptWithoutAppend.length
      guidelines = promptWithoutAppend.slice(guidelinesStart, guidelinesEnd).trim()
    }

    if (docsStart !== -1) {
      documentation = promptWithoutAppend.slice(docsStart).trim()
    }
  } else {
    baseTemplate = promptWithoutAppend.trim()
  }

  // Determine metadata labels
  let baseLabel = '无'
  if (composition?.customPrompt) {
    baseLabel = '自定义模板'
  } else if (baseTemplate) {
    baseLabel = '默认模板'
  }

  let toolsLabel = '无'
  const toolsCount = composition?.selectedTools?.length ?? countToolLines(availableTools)
  if (toolsCount > 0) {
    toolsLabel = `${toolsCount} 个工具`
  } else if (availableTools) {
    toolsLabel = '有内容'
  }

  let guidelinesLabel = '无'
  const guidelinesCount = composition?.promptGuidelines?.length ?? countGuidelineLines(guidelines)
  if (guidelinesCount > 0) {
    guidelinesLabel = `${guidelinesCount} 条规则`
  } else if (guidelines) {
    guidelinesLabel = '有内容'
  }

  const docsLabel = documentation ? '内置文档' : '无'
  const appendLabel = appendPrompt ? '有内容' : '无'

  let contextLabel = '无'
  const contextFilesCount = composition?.contextFiles?.length ?? 0
  if (contextFilesCount > 0) {
    contextLabel = `${contextFilesCount} 个文件`
  } else if (projectContext) {
    contextLabel = '有内容'
  }

  let skillsLabel = '无'
  const skillsCount = composition?.skills?.length ?? 0
  if (skillsCount > 0) {
    skillsLabel = `${skillsCount} 个 skills`
  } else if (skillsContent) {
    skillsLabel = '有内容'
  }

  const baseTemplateItem: PromptSectionItem = {
    id: 'base-template',
    index: 1,
    title: '基础模板',
    meta: formatMetaWithChars(baseLabel, baseTemplate.length),
    content: baseTemplate || '无',
    charCount: baseTemplate.length,
    estimatedTokens: Math.ceil(baseTemplate.length / 4),
    isEmpty: !baseTemplate,
  }

  const availableToolsItem: PromptSectionItem = {
    id: 'available-tools',
    index: 2,
    title: '可用工具',
    meta: formatMetaWithChars(toolsLabel, availableTools.length),
    content: availableTools || '无',
    charCount: availableTools.length,
    estimatedTokens: Math.ceil(availableTools.length / 4),
    isEmpty: !availableTools,
  }

  const guidelinesItem: PromptSectionItem = {
    id: 'guidelines',
    index: 3,
    title: '行为准则',
    meta: formatMetaWithChars(guidelinesLabel, guidelines.length),
    content: guidelines || '无',
    charCount: guidelines.length,
    estimatedTokens: Math.ceil(guidelines.length / 4),
    isEmpty: !guidelines,
  }

  const documentationItem: PromptSectionItem = {
    id: 'documentation',
    index: 4,
    title: '系统文档指引',
    meta: formatMetaWithChars(docsLabel, documentation.length),
    content: documentation || '无',
    charCount: documentation.length,
    estimatedTokens: Math.ceil(documentation.length / 4),
    isEmpty: !documentation,
  }

  const appendPromptItem: PromptSectionItem = {
    id: 'append-prompt',
    index: 5,
    title: '追加指令',
    meta: formatMetaWithChars(appendLabel, appendPrompt.length),
    content: appendPrompt || '无',
    charCount: appendPrompt.length,
    estimatedTokens: Math.ceil(appendPrompt.length / 4),
    isEmpty: !appendPrompt,
  }

  const projectContextItem: PromptSectionItem = {
    id: 'project-context',
    index: 6,
    title: '项目上下文',
    meta: formatMetaWithChars(contextLabel, projectContext.length),
    content: projectContext || '无',
    charCount: projectContext.length,
    estimatedTokens: Math.ceil(projectContext.length / 4),
    isEmpty: !projectContext,
  }

  const skillsItem: PromptSectionItem = {
    id: 'skills',
    index: 7,
    title: 'Skills',
    meta: formatMetaWithChars(skillsLabel, skillsContent.length),
    content: skillsContent || '无',
    charCount: skillsContent.length,
    estimatedTokens: Math.ceil(skillsContent.length / 4),
    isEmpty: !skillsContent,
  }

  const cwdItem: PromptSectionItem = {
    id: 'cwd',
    index: 8,
    title: '工作目录',
    meta: formatMetaWithChars('', cwdContent.length),
    content: cwdContent || '无',
    charCount: cwdContent.length,
    estimatedTokens: Math.ceil(cwdContent.length / 4),
    isEmpty: !cwdContent,
  }

  const items = [
    baseTemplateItem,
    availableToolsItem,
    guidelinesItem,
    documentationItem,
    appendPromptItem,
    projectContextItem,
    skillsItem,
    cwdItem,
  ]

  return {
    baseTemplate: baseTemplateItem,
    availableTools: availableToolsItem,
    guidelines: guidelinesItem,
    documentation: documentationItem,
    appendPrompt: appendPromptItem,
    projectContext: projectContextItem,
    skills: skillsItem,
    cwd: cwdItem,
    items,
  }
}
