#!/usr/bin/env node
/**
 * Generates the committed system-prompt fixtures from Pi's own prompt builder.
 *
 * The fixtures are produced by `buildSystemPrompt()` from a real
 * `@earendil-works/pi-coding-agent` installation, never by hand. Tests then
 * parse the fixture and assert it against the `options` recorded alongside it,
 * so an expectation can only be wrong if Pi itself produced something else.
 *
 * Usage:
 *   node scripts/generate-prompt-fixtures.mjs --pi <path-to-pi-package> \
 *     --version 1.2.0 --variant full --out tests/fixtures/prompts/pi-1.2.0-full.json
 *
 * To regenerate the 0.85.x (legacy header layout) fixtures:
 *   npm install --prefix /tmp/pi-0851 @earendil-works/pi-coding-agent@0.85.1
 *   node scripts/generate-prompt-fixtures.mjs --pi /tmp/pi-0851/node_modules/@earendil-works/pi-coding-agent \
 *     --version 0.85.1 --variant legacy --out tests/fixtures/prompts/pi-0.85.1-full.json
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const BUILTIN_TOOL_FILES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'powershell']

/** Real `promptSnippet`/`promptGuidelines` of Pi's built-in tools, read from Pi itself. */
export async function readPiToolContributions(piPackageDir) {
  const contributions = {}
  for (const tool of BUILTIN_TOOL_FILES) {
    let module
    try {
      module = await import(pathToFileURL(path.join(piPackageDir, 'dist/core/tools', `${tool}.js`)).href)
    } catch {
      continue
    }
    for (const key of Object.keys(module)) {
      const value = module[key]
      if (value && typeof value === 'object' && typeof value.snippet === 'string') {
        contributions[value.name ?? tool] = { snippet: value.snippet, guidelines: value.guidelines ?? [] }
      }
    }
  }
  return contributions
}

/** Fixed, machine-independent values so the committed fixtures stay stable. */
export const FIXTURE_OPTIONS = {
  cwd: '/work/demo',
  selectedTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'skill'],
  toolSnippets: {
    read: 'Read file contents',
    bash: 'Execute bash commands (ls, grep, find, etc.)',
    edit: 'Make precise file edits',
    write: 'Create or overwrite files',
    grep: 'Grep file contents',
    find: 'Find files by path or glob',
    skill: 'Load a skill by name',
  },
  promptGuidelines: ['Never commit secrets'],
  appendSystemPrompt: 'Answer in Chinese.',
  contextFiles: [{ path: '/work/demo/AGENTS.md', content: 'Use tests first.' }],
  skills: [
    {
      name: 'tdd',
      description: 'Test-driven development',
      filePath: '/skills/tdd/SKILL.md',
      baseDir: '/skills/tdd',
      disableModelInvocation: false,
    },
  ],
}

export async function buildFixturePrompt(piPackageDir, variant = 'full') {
  const systemPrompt = await import(pathToFileURL(path.join(piPackageDir, 'dist/core/system-prompt.js')).href)
  if (typeof systemPrompt.buildSystemPrompt !== 'function') {
    throw new Error(`No buildSystemPrompt() in ${piPackageDir}; Pi's layout changed and this script must be updated`)
  }
  const options =
    variant === 'vanilla' ? await vanillaFixtureOptions(piPackageDir)
    : variant === 'mcp' ? await mcpFixtureOptions(piPackageDir)
    : FIXTURE_OPTIONS
  const prompt = systemPrompt.buildSystemPrompt(options)
  // Pi embeds absolute documentation paths; normalize them so the fixture does
  // not depend on where Pi happens to be installed.
  return { prompt: prompt.split(piPackageDir).join('<pi-package>'), options }
}

/**
 * Full options plus the `mcp_servers` section Pi's MCP extension adds. The
 * section body comes from Pi's own `renderServersSection`, so the fixture holds
 * exactly what Pi would send.
 */
export async function mcpFixtureOptions(piPackageDir) {
  const mcp = await import(pathToFileURL(path.join(piPackageDir, 'dist/extensions/mcp/index.js')).href)
  if (typeof mcp.renderServersSection !== 'function' || typeof mcp.MCP_SERVERS_SECTION !== 'string') {
    throw new Error(`No renderServersSection()/MCP_SERVERS_SECTION in ${piPackageDir}; update this script`)
  }
  const servers = [
    {
      entry: { name: 'context7', config: { description: 'Library docs lookup for framework APIs', exposure: 'codemode' }, source: '/work/mcp.json', scope: 'global' },
      connection: {},
    },
    {
      entry: { name: 'dev-radius', config: { exposure: 'deferred' }, source: '/work/mcp.json', scope: 'global' },
      connection: { instructions: 'Internal design docs and ADRs.' },
    },
  ]
  const section = mcp.renderServersSection(servers)
  if (!section) throw new Error('renderServersSection returned nothing; the fixture would not cover mcp_servers')
  return { ...FIXTURE_OPTIONS, sections: { [mcp.MCP_SERVERS_SECTION]: section } }
}

/** Pi's out-of-the-box prompt inputs: defaults tools, no context, no skills. */
export async function vanillaFixtureOptions(piPackageDir) {
  const contributions = await readPiToolContributions(piPackageDir)
  const selectedTools = ['read', 'bash', 'edit', 'write']
  const toolSnippets = {}
  const toolGuidelines = {}
  for (const name of selectedTools) {
    toolSnippets[name] = contributions[name]?.snippet ?? ''
    toolGuidelines[name] = contributions[name]?.guidelines ?? []
  }
  return {
    cwd: '/work/demo',
    selectedTools,
    toolSnippets,
    toolGuidelines,
    promptGuidelines: [],
    appendSystemPrompt: '',
    contextFiles: [],
    skills: [],
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    if (key) args[key] = argv[i + 1]
  }
  return args
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (!args.pi || !args.out || !args.version) {
    console.error('Usage: node scripts/generate-prompt-fixtures.mjs --pi <dir> --version <v> [--variant full|vanilla|mcp] --out <file>')
    process.exit(1)
  }
  const variant = args.variant ?? 'full'
  const { prompt, options } = await buildFixturePrompt(path.resolve(args.pi), variant)
  const record = {
    generatedFrom: `@earendil-works/pi-coding-agent@${args.version}`,
    generatedBy: 'scripts/generate-prompt-fixtures.mjs',
    variant,
    note: "Produced by Pi's own buildSystemPrompt(); do not hand-edit.",
    options,
    prompt,
  }
  const outPath = path.resolve(args.out)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`)
  console.log(`wrote ${outPath} (${prompt.length} chars, from pi ${args.version}, ${variant})`)
}

export { BUILTIN_TOOL_FILES }
