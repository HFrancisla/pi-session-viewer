import { mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { chromium } from '@playwright/test'

const run = promisify(execFile)
const projectRoot = process.cwd()
const scratchDir = path.join(projectRoot, '.tmp-preview')
const sessionDir = path.join(scratchDir, 'sessions')
const projectDir = path.join(sessionDir, 'ecommerce-api')

await rm(scratchDir, { recursive: true, force: true })
await mkdir(projectDir, { recursive: true })

const session1Jsonl = `{"type":"session","version":3,"id":"ecommerce-perf-session","timestamp":"2026-03-15T14:20:00.000Z","cwd":"/work/ecommerce-api"}
{"type":"model_change","id":"model-1","parentId":null,"timestamp":"2026-03-15T14:20:00.100Z","provider":"anthropic","modelId":"claude-3-7-sonnet"}
{"type":"session_info","id":"info-1","parentId":"model-1","timestamp":"2026-03-15T14:20:00.150Z","name":"Profile query latency and fix connection leak"}
{"type":"message","id":"user-1","parentId":"info-1","timestamp":"2026-03-15T14:20:01.000Z","message":{"role":"user","timestamp":1773584401000,"content":"The checkout endpoint is experiencing query spikes under load. Can you profile the database queries and fix any connection pool leaks in the transaction runner?"}}
{"type":"custom","customType":"pi-session-viewer.system-prompt","id":"prompt-1","parentId":"user-1","timestamp":"2026-03-15T14:20:01.050Z","data":{"schemaVersion":1,"recordType":"snapshot","promptHash":"ecom-perf-hash-9182","prompt":"You are an expert backend engineer and performance specialist.\\n\\nAvailable tools:\\n- bash: Execute commands in the terminal\\n- read_file: Read contents of a project file\\n- write_file: Write contents to a project file\\n- pg_inspect: Inspect PostgreSQL query execution plans\\n\\nGuidelines:\\n- Follow test-driven development (TDD)\\n- Ensure database connections and transactions are safely released\\n\\n<project_context>\\n<project_instructions path=\\"/work/ecommerce-api/AGENTS.md\\">\\nUse Vitest for unit tests. Run pgbench for load tests before and after changes.\\n</project_instructions>\\n</project_context>\\n\\nCurrent working directory: /work/ecommerce-api","promptLength":542,"composition":{"selectedTools":["bash","read_file","write_file","pg_inspect"],"toolSnippets":{"bash":"Execute commands in the terminal","read_file":"Read contents of a project file","write_file":"Write contents to a project file","pg_inspect":"Inspect PostgreSQL query execution plans"},"toolDefinitions":[{"name":"bash","description":"Execute commands in a terminal","parameters":{"type":"object","properties":{"command":{"type":"string"}}}},{"name":"read_file","description":"Read contents of a project file","parameters":{"type":"object","properties":{"path":{"type":"string"}}}},{"name":"write_file","description":"Write contents to a project file","parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}}}},{"name":"pg_inspect","description":"Inspect PostgreSQL query execution plans","parameters":{"type":"object","properties":{"query":{"type":"string"}}}}],"promptGuidelines":["Follow test-driven development (TDD)","Ensure database connections and transactions are safely released"],"appendSystemPrompt":"Always verify database connection metrics after patching.","cwd":"/work/ecommerce-api","contextFiles":[{"path":"/work/ecommerce-api/AGENTS.md","content":"Use Vitest for unit tests. Run pgbench for load tests before and after changes."}],"skills":[{"name":"sql-optimization","description":"PostgreSQL index and query tuning","filePath":"/skills/sql-optimization/SKILL.md"}]},"targetUserEntryId":"user-1","sequence":1,"capturedAt":"2026-03-15T14:20:01.040Z","model":{"provider":"anthropic","id":"claude-3-7-sonnet"}}}
{"type":"message","id":"asst-1","parentId":"prompt-1","timestamp":"2026-03-15T14:20:02.000Z","message":{"role":"assistant","timestamp":1773584402000,"provider":"anthropic","model":"claude-3-7-sonnet","content":[{"type":"thinking","thinking":"I should first check the transaction error handler in src/db/pool.ts and run the checkout load benchmark to capture baseline latency."},{"type":"text","text":"I'll run the checkout benchmark and inspect the transaction handling in src/db/pool.ts."},{"type":"toolCall","id":"call-bench","name":"bash","arguments":{"command":"npm run bench:checkout"}},{"type":"toolCall","id":"call-read","name":"read_file","arguments":{"path":"src/db/pool.ts"}}]}}
{"type":"message","id":"res-read","parentId":"asst-1","timestamp":"2026-03-15T14:20:03.200Z","message":{"role":"toolResult","timestamp":1773584403200,"toolCallId":"call-read","toolName":"read_file","isError":false,"content":[{"type":"text","text":"// pool.ts\\nexport async function withTransaction(fn) {\\n  const client = await pool.connect();\\n  try {\\n    await client.query('BEGIN');\\n    const res = await fn(client);\\n    await client.query('COMMIT');\\n    return res;\\n  } catch (err) {\\n    await client.query('ROLLBACK');\\n    throw err; // Bug: missing client.release() in error catch block!\\n  }\\n}"}]}}
{"type":"message","id":"res-bench","parentId":"res-read","timestamp":"2026-03-15T14:20:04.500Z","message":{"role":"toolResult","timestamp":1773584404500,"toolCallId":"call-bench","toolName":"bash","isError":false,"content":[{"type":"text","text":"Running 50 concurrent workers for 5s...\\nRequests: 2,410 | Errors: 142 (Connection pool exhausted)\\np50: 68ms | p95: 490ms | p99: 1200ms"}]}}
{"type":"message","id":"asst-2","parentId":"res-bench","timestamp":"2026-03-15T14:20:05.500Z","message":{"role":"assistant","timestamp":1773584405500,"provider":"anthropic","model":"claude-3-7-sonnet","content":[{"type":"thinking","thinking":"The issue is clear: withTransaction releases the client on normal path, but on rollback error it throws without calling client.release(). We should use try/finally."},{"type":"text","text":"Found the leak: in \`withTransaction\`, \`client.release()\` is omitted when an error occurs during transaction execution, causing pool exhaustion under load. I will wrap connection release in a \`finally\` block and run tests."},{"type":"toolCall","id":"call-write","name":"write_file","arguments":{"path":"src/db/pool.ts"}}]}}
{"type":"message","id":"res-write","parentId":"asst-2","timestamp":"2026-03-15T14:20:06.200Z","message":{"role":"toolResult","timestamp":1773584406200,"toolCallId":"call-write","toolName":"write_file","isError":false,"content":[{"type":"text","text":"Successfully wrote 48 lines to src/db/pool.ts"}]}}
{"type":"message","id":"asst-3","parentId":"res-write","timestamp":"2026-03-15T14:20:07.000Z","message":{"role":"assistant","timestamp":1773584407000,"provider":"anthropic","model":"claude-3-7-sonnet","content":[{"type":"toolCall","id":"call-test","name":"bash","arguments":{"command":"npm test"}}]}}
{"type":"message","id":"res-test","parentId":"asst-3","timestamp":"2026-03-15T14:20:08.500Z","message":{"role":"toolResult","timestamp":1773584408500,"toolCallId":"call-test","toolName":"bash","isError":false,"content":[{"type":"text","text":"✓ tests/pool.test.ts (6 tests)\\n✓ tests/checkout.test.ts (18 tests)\\n\\nTest Files 2 passed (2)\\nTests 24 passed (24)\\nDuration 1.28s"}]}}
{"type":"message","id":"asst-4","parentId":"res-test","timestamp":"2026-03-15T14:20:09.500Z","message":{"role":"assistant","timestamp":1773584409500,"provider":"anthropic","model":"claude-3-7-sonnet","content":[{"type":"text","text":"All 24 unit and transaction tests pass. I'll re-run the benchmark to confirm the fix under load."},{"type":"toolCall","id":"call-bench2","name":"bash","arguments":{"command":"npm run bench:checkout"}}]}}
{"type":"message","id":"res-bench2","parentId":"asst-4","timestamp":"2026-03-15T14:20:12.000Z","message":{"role":"toolResult","timestamp":1773584412000,"toolCallId":"call-bench2","toolName":"bash","isError":false,"content":[{"type":"text","text":"Running 50 concurrent workers for 5s...\\nRequests: 4,890 | Errors: 0\\np50: 18ms | p95: 42ms | p99: 64ms"}]}}
{"type":"message","id":"asst-5","parentId":"res-bench2","timestamp":"2026-03-15T14:20:13.000Z","message":{"role":"assistant","timestamp":1773584413000,"provider":"anthropic","model":"claude-3-7-sonnet","content":[{"type":"text","text":"Benchmark confirmed: 0 connection errors, throughput doubled to 4,890 req, and p95 latency reduced from 490ms to 42ms."}]}}
`

const session2Jsonl = `{"type":"session","version":3,"id":"ecommerce-idempotency-session","timestamp":"2026-03-14T11:00:00.000Z","cwd":"/work/ecommerce-api"}
{"type":"session_info","id":"info-2","parentId":null,"timestamp":"2026-03-14T11:00:00.100Z","name":"Implement idempotency keys for checkout payments"}
{"type":"message","id":"user-2","parentId":"info-2","timestamp":"2026-03-14T11:00:01.000Z","message":{"role":"user","timestamp":1773486001000,"content":"Add Redis-backed idempotency key validation to avoid duplicate charge requests."}}
{"type":"message","id":"asst-2","parentId":"user-2","timestamp":"2026-03-14T11:00:03.000Z","message":{"role":"assistant","timestamp":1773486003000,"content":[{"type":"text","text":"Implemented idempotency middleware with 24h TTL."}]}}
`

await writeFile(path.join(projectDir, 'perf.jsonl'), session1Jsonl)
await writeFile(path.join(projectDir, 'idempotency.jsonl'), session2Jsonl)

const token = 'preview-token'
const port = 5195
const standalonePath = path.join(projectRoot, 'dist', 'standalone', 'index.js')

const child = spawn(process.execPath, [standalonePath], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(port),
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    PI_SESSION_VIEWER_TOKEN: token,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const startupLine = await new Promise((resolve, reject) => {
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
    const line = output.split(/\r?\n/).find((val) => val.includes('http://127.0.0.1:'))
    if (line) resolve(line)
  })
  child.once('error', reject)
  child.once('exit', (code) => reject(new Error('exit ' + code)))
})

console.log('Server started:', startupLine)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  locale: 'en-US',
})
const page = await context.newPage()

// Ensure localStorage is en
await page.addInitScript(() => {
  localStorage.setItem('pi_session_viewer_locale', 'en')
})

await page.goto(`http://127.0.0.1:${port}/#token=${token}`, { waitUntil: 'networkidle' })

// Switch to All projects scope in sidebar
const allScopeTab = page.locator('.scope-tab').filter({ hasText: 'All' })
if (await allScopeTab.isVisible()) {
  await allScopeTab.click()
  await page.waitForTimeout(400)
}

// Click on the perf session
const sessionCard = page.getByText('Profile query latency and fix connection leak').first()
if (await sessionCard.isVisible()) {
  await sessionCard.click()
  await page.waitForTimeout(600)
}

// Click the System Prompt event to show rich prompt composition
const systemPromptRow = page.locator('.event--system-prompt').first()
if (await systemPromptRow.isVisible()) {
  await systemPromptRow.click()
  await page.waitForTimeout(500)
}

// Switch to Composition tab in Inspector
const compositionTab = page.getByRole('tab', { name: 'Composition' })
if (await compositionTab.isVisible()) {
  await compositionTab.click()
  await page.waitForTimeout(400)

  // Expand the first two sections
  const summaries = page.locator('.prompt-composition summary')
  const count = await summaries.count()
  for (let i = 0; i < Math.min(count, 3); i++) {
    await summaries.nth(i).click()
  }
  await page.waitForTimeout(400)
}

const pngPath = path.join(scratchDir, 'preview-temp.png')
const webpPath = path.join(projectRoot, 'assets', 'gallery-preview.webp')

await page.screenshot({ path: pngPath })
console.log('PNG captured:', pngPath)

await browser.close()
child.kill('SIGTERM')

// Convert with cwebp to WebP (quality 90)
await run('cwebp', ['-q', '90', pngPath, '-o', webpPath])
console.log('WebP generated:', webpPath)

await rm(scratchDir, { recursive: true, force: true })
console.log('Done!')
