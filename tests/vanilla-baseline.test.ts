import { expect, it } from 'vitest'
import { loadVanillaBaseline } from '../server/vanilla-baseline'
import { renderVanillaBaseline } from '../src/core/vanilla-baseline'
import { computeLineDiff } from '../src/core/native-diff'
import { getSystemMessageText } from '@earendil-works/pi-ai/utils/text'
import { importPiInternal, loadPiSystemPrompt, PI_VERSION } from './helpers/pi-runtime'
import type { SystemMessage } from '@earendil-works/pi-ai'

it('Vanilla 与 Pi 原生默认构建结果一致，额外分区仅在被比较提示词中出现', async () => {
  const cwd = '/work/demo'
  const baseline = await loadVanillaBaseline()
  const { buildSystemPromptSections } = await loadPiSystemPrompt()
  const { createCodingToolDefinitions } = await importPiInternal<{
    createCodingToolDefinitions(cwd: string): Array<{name: string; promptSnippet?: string; promptGuidelines?: string[]}>
  }>('dist/core/tools/index.js')
  const tools = createCodingToolDefinitions(cwd)
  const sections = buildSystemPromptSections({
    cwd, selectedTools: tools.map(tool => tool.name),
    toolSnippets: Object.fromEntries(tools.map(tool => [tool.name, tool.promptSnippet])),
    toolGuidelines: Object.fromEntries(tools.map(tool => [tool.name, tool.promptGuidelines ?? []])),
    contextFiles: [], skills: [],
  })
  const message: SystemMessage = { role: 'system', content: '', timestamp: 1, sections }
  expect(baseline.version).toBe(PI_VERSION)
  expect(renderVanillaBaseline(baseline, message, cwd)).toBe(getSystemMessageText(message))
  const modified: SystemMessage = { ...message, sections: {
    ...sections, docs: sections.docs.replace('Before implementing harness changes', 'Modified docs rule'),
    extension_section: '<extension_section>\nExtension added instruction\n</extension_section>',
  } }
  const diff = computeLineDiff(renderVanillaBaseline(baseline, modified, cwd), getSystemMessageText(modified))
  expect(diff.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'added', text: 'Extension added instruction' }),
    expect.objectContaining({ type: 'added', text: expect.stringContaining('Modified docs rule') }),
    expect.objectContaining({ type: 'removed', text: expect.stringContaining('Before implementing harness changes') }),
  ]))
  expect(renderVanillaBaseline(baseline, { ...message, sections: {} })).toContain('<cwd>')
  expect(renderVanillaBaseline(baseline, { ...message, sections: {} })).toContain('<pi-package>')
})
