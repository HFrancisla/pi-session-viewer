import { getSystemMessageText } from '@earendil-works/pi-ai/utils/text'
import type { SystemMessage } from '@earendil-works/pi-ai'

export interface VanillaBaseline {
  version: string
  sections: Record<string, string>
}

// 只从原生 docs 分区提取一致的安装路径；不复制该分区的其他内容。
function recordedPackageRoot(docs: string | null | undefined): string | undefined {
  if (!docs) return undefined
  const root = docs.match(/^- Main documentation: (.+)\/README\.md$/m)?.[1]
  if (!root) return undefined
  const lines = docs.split('\n')
  return lines.includes(`- Additional docs: ${root}/docs`)
    && lines.includes(`- Examples: ${root}/examples (extensions, custom tools, SDK)`) ? root : undefined
}

export function renderVanillaBaseline(baseline: VanillaBaseline, target: SystemMessage, cwd?: string): string {
  const sections = { ...baseline.sections }
  const packageRoot = recordedPackageRoot(target.sections?.docs) ?? '<pi-package>'
  sections.docs = sections.docs.replaceAll('__PI_VIEWER_PACKAGE__', () => packageRoot)
  if (cwd !== undefined) {
    sections.cwd = sections.cwd.replaceAll('__PI_VIEWER_CWD__', () => cwd.replace(/\\/g, '/'))
  } else {
    sections.cwd = sections.cwd.replaceAll('__PI_VIEWER_CWD__', '<cwd>')
  }
  return getSystemMessageText({ role: 'system', content: '', sections, timestamp: 0 })
}
