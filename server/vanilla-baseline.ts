import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { VanillaBaseline } from '../src/core/vanilla-baseline'

// 在构建/开发服务启动时调用 Pi 自己的构建器，不在浏览器加载 Node 运行时。
export async function loadVanillaBaseline(): Promise<VanillaBaseline> {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))))
  const load = (relative: string) => import(pathToFileURL(join(directory, relative)).href)
  const { buildSystemPromptSections } = await load('dist/core/system-prompt.js')
  const { createCodingToolDefinitions } = await load('dist/core/tools/index.js')
  const { getPackageDir } = await load('dist/config.js')
  const version = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version as string
  const definitions = createCodingToolDefinitions('__PI_VIEWER_CWD__') as Array<{
    name: string; promptSnippet?: string; promptGuidelines?: string[]
  }>
  const sections = buildSystemPromptSections({
    cwd: '__PI_VIEWER_CWD__',
    selectedTools: definitions.map(tool => tool.name),
    toolSnippets: Object.fromEntries(definitions.filter(tool => tool.promptSnippet).map(tool => [tool.name, tool.promptSnippet])),
    toolGuidelines: Object.fromEntries(definitions.map(tool => [tool.name, tool.promptGuidelines ?? []])),
    contextFiles: [], skills: [],
  }) as Record<string, string>
  // 安装路径和工作目录不是插件修改；以标记替代构建机器路径。
  sections.docs = sections.docs.split(getPackageDir()).join('__PI_VIEWER_PACKAGE__')
  return { version, sections }
}
