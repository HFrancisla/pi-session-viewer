#!/usr/bin/env node
/**
 * Regenerates the fixtures that must track the installed Pi:
 *
 *   - tests/fixtures/prompts/current-full.json / current-vanilla.json
 *   - tests/fixtures/sessions/demo/demo.jsonl (its captured prompt)
 *
 * Run this after upgrading Pi. The contract tests fail first on purpose — they
 * tell you to review the parser against the new Pi before refreshing:
 *
 *   npm run fixtures:refresh
 *
 * The frozen `legacy-0.85.1-*.json` fixtures (Pi's pre-0.86 header layout) are
 * not touched; regenerate them from a 0.85.1 install if ever needed:
 *
 *   npm install --prefix /tmp/pi-0851 @earendil-works/pi-coding-agent@0.85.1
 *   node scripts/generate-prompt-fixtures.mjs --pi /tmp/pi-0851/node_modules/@earendil-works/pi-coding-agent \
 *     --version 0.85.1 --variant full --out tests/fixtures/prompts/legacy-0.85.1-full.json
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PI_PACKAGE_DIR = path.resolve('node_modules/@earendil-works/pi-coding-agent')

let version
{
  let packageJson
  try {
    packageJson = JSON.parse(await readFile(path.join(PI_PACKAGE_DIR, 'package.json'), 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read the installed Pi version from ${PI_PACKAGE_DIR}: ${error instanceof Error ? error.message : String(error)}`)
  }
  version = packageJson.version
}
console.log(`Refreshing fixtures from @earendil-works/pi-coding-agent@${version}`)

for (const variant of ['full', 'vanilla', 'mcp']) {
  const { stdout } = await run(process.execPath, [
    'scripts/generate-prompt-fixtures.mjs',
    '--pi',
    PI_PACKAGE_DIR,
    '--version',
    version,
    '--variant',
    variant,
    '--out',
    `tests/fixtures/prompts/current-${variant}.json`,
  ])
  process.stdout.write(stdout)
}

const demo = await run(process.execPath, ['scripts/refresh-demo-session.mjs', '--pi', PI_PACKAGE_DIR])
process.stdout.write(demo.stdout)

console.log('Done. Review the diff and re-run npm test.')
