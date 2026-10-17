import { expect, test } from '@playwright/test'

const cwd = '/work/demo'

/**
 * The file's version is the single source of truth: the catalog and the session
 * payload both derive their `modifiedAt` from it, exactly as the real server keeps
 * both from the same `stat`. That is what makes a cache key comparable.
 */
let versions: Record<string, string> = {}
let labels: Record<string, string> = {}
let titles: Record<string, string> = {}

function session(token: string) {
  return {
    token,
    id: token,
    title: titles[token] ?? `Session ${token}`,
    cwd,
    timestamp: '2026-01-01T00:00:00.000Z',
    modifiedAt: `2026-01-01T00:00:0${versions[token]}.000Z`,
    relativePath: `demo/${token}.jsonl`,
  }
}

function content(label: string): string {
  return [
    JSON.stringify({ type: 'session', version: 3, id: 'session', timestamp: '2026-01-01T00:00:00.000Z', cwd }),
    JSON.stringify({
      type: 'message',
      id: 'u1',
      parentId: null,
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'user', timestamp: 1, content: label },
    }),
  ].join('\n')
}

test('a revisited session is served from the client cache', async ({ page }) => {
  versions = { alpha: '1', beta: '2' }
  labels = { alpha: 'Open session A', beta: 'Open session B' }
  titles = {}
  const requests: string[] = []

  await page.route('**/api/sessions', async (route) => {
    await route.fulfill({
      json: { root: '/synthetic/sessions', currentCwd: cwd, sessions: Object.keys(versions).map(session), warnings: [] },
    })
  })
  await page.route('**/api/sessions/*', async (route) => {
    const token = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '')
    requests.push(token)
    if (!versions[token]) {
      await route.fulfill({ status: 404, json: { error: 'not found' } })
      return
    }
    await route.fulfill({
      json: {
        token,
        relativePath: `demo/${token}.jsonl`,
        modifiedAt: session(token).modifiedAt,
        content: content(labels[token]),
      },
    })
  })

  await page.goto('/#token=dev-token&cwd=/work/demo')
  await expect(page.getByText('Open session A', { exact: true }).first()).toBeVisible()
  expect(requests).toEqual(['alpha'])

  const parses = () => page.evaluate(() => performance.getEntriesByName('pi-session-viewer:parse-session').length)

  // Visit the other session, then come back: neither a request nor a parse.
  await page.getByRole('button', { name: /Session beta/ }).click()
  await expect(page.getByText('Open session B', { exact: true }).first()).toBeVisible()
  const parsesAfterBoth = await parses()

  await page.getByRole('button', { name: /Session alpha/ }).click()
  await expect(page.getByText('Open session A', { exact: true }).first()).toBeVisible()
  expect(requests).toEqual(['alpha', 'beta'])
  expect(await parses()).toBe(parsesAfterBoth)

  // Catalog metadata refreshes independently from an unchanged body version.
  titles.alpha = 'Session alpha (renamed in catalog)'
  await page.getByRole('button', { name: 'Reload sessions and list' }).click()
  await expect(page.getByRole('button', { name: 'Reload sessions and list' })).toBeEnabled()
  await expect(page.locator('.session-item').filter({ hasText: 'Session alpha (renamed in catalog)' })).toBeVisible()
  expect(requests).toEqual(['alpha', 'beta'])
  expect(await parses()).toBe(parsesAfterBoth)

  // When alpha changes on disk, the catalog identity changes and refresh fetches
  // the body once; the updated entry is reused on later visits.
  versions.alpha = '3'
  labels.alpha = 'Open session A (updated)'
  await page.getByRole('button', { name: 'Reload sessions and list' }).click()
  await expect(page.getByText('Open session A (updated)', { exact: true }).first()).toBeVisible()
  expect(requests).toEqual(['alpha', 'beta', 'alpha'])

  // What the reload stored is what a later visit hits.
  await page.getByRole('button', { name: /Session beta/ }).click()
  await expect(page.getByText('Open session B', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /Session alpha/ }).click()
  await expect(page.getByText('Open session A (updated)', { exact: true }).first()).toBeVisible()
  expect(requests).toEqual(['alpha', 'beta', 'alpha'])
})
