#!/usr/bin/env node
/**
 * Rebuilds the demo session's captured system prompt from its own recorded
 * composition using Pi's real prompt builder.
 *
 * The demo fixture used to carry a hand-written prompt that matched no Pi
 * release, which meant the Playwright test exercised a layout users never see.
 * Regenerating it keeps the fixture internally consistent and in the layout of
 * the currently installed Pi:
 *
 *   node scripts/refresh-demo-session.mjs [--pi <path-to-pi-package>] [--file <session.jsonl>]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_SESSION = 'tests/fixtures/sessions/demo/demo.jsonl'
/** Run id of the subagent reference whose artifacts are deliberately absent. */
const MISSING_SUBAGENT_RUN_ID = '22222222-2222-2222-2222-222222222222'
const DEFAULT_PI = 'node_modules/@earendil-works/pi-coding-agent'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    if (key) args[key] = argv[i + 1]
  }
  return args
}

export async function rebuildDemoPrompt(piPackageDir, composition) {
  const systemPrompt = await import(pathToFileURL(path.join(piPackageDir, 'dist/core/system-prompt.js')).href)
  if (typeof systemPrompt.buildSystemPrompt !== 'function') {
    throw new Error(`No buildSystemPrompt() in ${piPackageDir}; this script must be updated`)
  }
  return systemPrompt.buildSystemPrompt({
    cwd: composition.cwd,
    selectedTools: composition.selectedTools ?? [],
    toolSnippets: composition.toolSnippets ?? {},
    toolGuidelines: {},
    promptGuidelines: composition.promptGuidelines ?? [],
    appendSystemPrompt: composition.appendSystemPrompt ?? '',
    contextFiles: composition.contextFiles ?? [],
    skills: (composition.skills ?? []).map((skill) => ({
      ...skill,
      baseDir: skill.baseDir ?? path.dirname(skill.filePath),
    })),
  })
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const file = path.resolve(args.file ?? DEFAULT_SESSION)
  const piPackageDir = path.resolve(args.pi ?? DEFAULT_PI)

  const contents = await readFile(file, 'utf8')
  const lines = contents.split('\n')
  const index = lines.findIndex((line) => line.includes('"pi-session-viewer.system-prompt"'))
  if (index === -1) throw new Error(`No captured system prompt in ${file}`)

  let entry
  try {
    entry = JSON.parse(lines[index])
  } catch (error) {
    throw new Error(`Captured system prompt entry in ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!entry.data?.composition) throw new Error('Captured entry has no composition to rebuild from')

  // Keep the fixture machine independent: Pi embeds absolute documentation paths.
  const prompt = (await rebuildDemoPrompt(piPackageDir, entry.data.composition)).split(piPackageDir).join('<pi-package>')
  entry.data.prompt = prompt
  entry.data.promptLength = prompt.length
  entry.data.promptHash = createHash('sha256').update(prompt).digest('hex')
  lines[index] = JSON.stringify(entry)

  // Keep the synthetic subagent reference on the tool result: the Playwright test
  // that a failed subagent jump does not wipe the timeline depends on it, and the
  // prompt rebuild above would otherwise drop it.
  const resultIndex = lines.findIndex((line) => line.includes('"id":"result"') || line.includes('"id": "result"'))
  if (resultIndex !== -1) {
    let resultEntry
    try {
      resultEntry = JSON.parse(lines[resultIndex])
    } catch (error) {
      throw new Error(`Tool result entry in ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (resultEntry.message?.role === 'toolResult') {
      resultEntry.message.details = {
        runId: MISSING_SUBAGENT_RUN_ID,
        results: [
          {
            targetFile: `subagent-artifacts/${MISSING_SUBAGENT_RUN_ID}_scout_transcript.jsonl`,
            agent: 'scout',
            task: 'check tests',
          },
        ],
      }
      lines[resultIndex] = JSON.stringify(resultEntry)
    }
  }

  await writeFile(file, lines.join('\n'))
  console.log(`rebuilt ${file} prompt from pi at ${piPackageDir} (${prompt.length} chars)`)
}
