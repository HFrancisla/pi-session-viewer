import { performance } from 'node:perf_hooks'
import { expect, test } from '@playwright/test'

const cwd = '/synthetic/project'
const sessionToken = 'synthetic-large-session'
const sessionTimestamp = '2026-01-01T00:00:00.000Z'

function syntheticSession() {
  const entries: unknown[] = [{
    type: 'session',
    version: 3,
    id: sessionToken,
    timestamp: sessionTimestamp,
    cwd,
  }]
  let parentId: string | null = null

  for (let index = 0; index < 400; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
    const userId = `synthetic-user-${index}`
    const assistantId = `synthetic-assistant-${index}`
    const resultId = `synthetic-result-${index}`
    const callId = `synthetic-call-${index}`
    const longText = index % 3 === 0 ? ` ${'Additional response detail '.repeat(10)}` : ''

    entries.push({
      type: 'message',
      id: userId,
      parentId,
      timestamp,
      message: {
        role: 'user',
        timestamp: Date.parse(timestamp),
        content: `Synthetic request ${index + 1}`,
      },
    })
    entries.push({
      type: 'message',
      id: assistantId,
      parentId: userId,
      timestamp,
      message: {
        role: 'assistant',
        timestamp: Date.parse(timestamp),
        content: [
          { type: 'text', text: `Synthetic assistant response ${index + 1}.${longText}` },
          { type: 'thinking', thinking: `Synthetic reasoning ${index + 1}` },
          { type: 'toolCall', id: callId, name: 'bash', arguments: { command: `printf ${index + 1}` } },
        ],
      },
    })
    entries.push({
      type: 'message',
      id: resultId,
      parentId: assistantId,
      timestamp,
      message: {
        role: 'toolResult',
        timestamp: Date.parse(timestamp),
        toolCallId: callId,
        toolName: 'bash',
        isError: false,
        content: [{ type: 'text', text: `Synthetic result ${index + 1}` }],
      },
    })
    parentId = resultId
  }

  return entries.map((entry) => JSON.stringify(entry)).join('\n')
}

test('virtualizes and preserves a 2,000-event grouped timeline', async ({ page }) => {
  const content = syntheticSession()
  const browserErrors: string[] = []
  const requestStartedAt = new Map<string, number>()
  let fetchMs: number | undefined
  const navigationStartedAt = performance.now()

  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  page.on('request', (request) => {
    if (request.url().endsWith(`/api/sessions/${sessionToken}`)) {
      requestStartedAt.set(request.url(), performance.now())
    }
  })
  page.on('response', (response) => {
    const startedAt = requestStartedAt.get(response.url())
    if (startedAt != null) fetchMs = performance.now() - startedAt
  })

  await page.route('**/api/sessions', async (route) => {
    await route.fulfill({
      json: {
        root: '/synthetic/sessions',
        currentCwd: cwd,
        warnings: [],
        sessions: [{
          token: sessionToken,
          id: sessionToken,
          title: 'Synthetic 2,000 event session',
          cwd,
          timestamp: sessionTimestamp,
          modifiedAt: sessionTimestamp,
          relativePath: 'synthetic-large-session.jsonl',
        }],
      },
    })
  })
  await page.route(`**/api/sessions/${sessionToken}`, async (route) => {
    await route.fulfill({
      json: {
        token: sessionToken,
        relativePath: 'synthetic-large-session.jsonl',
        modifiedAt: sessionTimestamp,
        content,
      },
    })
  })

  await page.goto('/#token=dev-token')
  const rows = page.locator('.event-row')
  await expect(page.locator('.header-session strong')).toContainText('Synthetic request 1')
  await expect(page.locator('.branch-bar')).toContainText('2001 visible events')

  const initialMountedCount = await rows.count()
  const firstRenderMs = performance.now() - navigationStartedAt
  expect(initialMountedCount).toBeGreaterThan(0)
  expect(initialMountedCount).toBeLessThan(60)
  const firstEventId = await rows.first().getAttribute('data-event-id')
  await expect(page.locator('.turn-group > header').filter({ hasText: 'Turn 1' })).toBeAttached()
  if (process.env.TIMELINE_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.TIMELINE_SCREENSHOT_PATH })
  }

  const initialHeights = await rows.evaluateAll((elements) => (
    elements.map((element) => Math.round(element.getBoundingClientRect().height))
  ))
  expect(new Set(initialHeights).size).toBeGreaterThan(1)
  const firstLlmGroup = page.locator('.event-row[data-llm-output-group="synthetic-assistant-0"]')
  await expect(firstLlmGroup).toHaveCount(3)
  await expect(page.locator('.event-row.llm-output-group-start[data-llm-output-group="synthetic-assistant-0"]')).toHaveCount(1)
  await expect(page.locator('.event-row.llm-output-group-end[data-llm-output-group="synthetic-assistant-0"]')).toHaveCount(1)
  await expect(page.locator('.event-row[data-event-id="synthetic-assistant-0:tool:2"] .causal-rail--start'))
    .toHaveAttribute('data-call-id', 'synthetic-call-0')
  await expect(page.locator('.event-row[data-event-id="synthetic-result-0:result"] .causal-rail--end'))
    .toHaveAttribute('data-call-id', 'synthetic-call-0')

  const firstKeyboardEvent = page.locator(`.event-row[data-event-id="${firstEventId}"]`)
  await page.locator('#branch-select').focus()
  await expect(page.locator('#branch-select')).toBeFocused()
  await page.keyboard.press('Tab')
  const timelineList = page.getByRole('listbox', { name: 'Session timeline' })
  await expect(timelineList).toBeFocused()
  await expect(timelineList).toHaveAttribute('aria-activedescendant', `event-row-${firstEventId}`)
  await page.keyboard.press('Enter')
  await expect(page.locator('.inspector-heading p')).toHaveText('System prompt unrecorded')
  await expect(firstKeyboardEvent).toHaveAttribute('aria-selected', 'true')

  for (let index = 0; index < 51; index += 1) {
    await page.keyboard.press('ArrowDown')
  }

  const focusedKeyboardEvent = page.locator('.event-row[data-event-id="synthetic-user-10:user"]')
  await expect(timelineList).toBeFocused()
  await expect(timelineList).toHaveAttribute('aria-activedescendant', 'event-row-synthetic-user-10:user')
  await expect(focusedKeyboardEvent).toHaveAttribute('aria-label', /Focused event 52 of 2001/)
  await expect(firstKeyboardEvent).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Focused event 52 of 2001')
  await expect(page.locator('.inspector-heading p')).toHaveText('System prompt unrecorded')

  const previousKeyboardEvent = page.locator('.event-row[data-event-id="synthetic-result-9:result"]')
  await page.keyboard.press('ArrowUp')
  await expect(timelineList).toHaveAttribute('aria-activedescendant', 'event-row-synthetic-result-9:result')
  await expect(previousKeyboardEvent).toHaveAttribute('aria-label', /Focused event 51 of 2001/)
  await page.keyboard.press('ArrowDown')
  await expect(timelineList).toHaveAttribute('aria-activedescendant', 'event-row-synthetic-user-10:user')

  await page.keyboard.press('Space')
  await expect(focusedKeyboardEvent).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.inspector-heading p')).toHaveText('User')
  await page.keyboard.press('Tab')
  await expect(page.locator('.timeline-scroll:focus, .event-row:focus')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Content' }).click()
  await expect(page.locator('.inspector')).toContainText('Synthetic request 11')
  await timelineList.evaluate((element) => { element.scrollTop = 0 })

  const selectedAssistant = page.locator('.event-row[data-event-id="synthetic-assistant-0:assistant:0"]')
  const selectionStartedAt = performance.now()
  await selectedAssistant.click()
  await expect(page.locator('.inspector')).toContainText('Synthetic assistant response 1.')
  const selectionInspectorMs = performance.now() - selectionStartedAt

  await page.getByLabel('Pi Response', { exact: true }).uncheck()
  await expect(selectedAssistant).toHaveCount(0)
  await expect(page.locator('.inspector')).toContainText('Synthetic assistant response 1.')
  await page.getByLabel('Pi Response', { exact: true }).check()
  await expect(selectedAssistant).toHaveClass(/is-selected/)

  const scrollStartedAt = performance.now()
  const scrollContainer = page.locator('.timeline-scroll')
  await page.setViewportSize({ width: 1280, height: 560 })
  await scrollContainer.evaluate((element) => { element.scrollTop = 0 })
  await expect(rows.first()).toBeVisible()
  await expect(rows.first()).toHaveAttribute('data-event-id', firstEventId!)
  const visitedRows = await scrollContainer.evaluate(async (element) => {
    const eventIds = new Set<string>()
    const collectMountedRows = () => {
      element.querySelectorAll<HTMLElement>('.event-row[data-event-id]').forEach((row) => {
        if (row.dataset.eventId) eventIds.add(row.dataset.eventId)
      })
    }
    const maxScroll = element.scrollHeight - element.clientHeight
    for (let scrollTop = 0; scrollTop < maxScroll; scrollTop += 600) {
      element.scrollTop = scrollTop
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      collectMountedRows()
    }
    element.scrollTop = maxScroll
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    collectMountedRows()
    return { count: eventIds.size, first: eventIds.values().next().value, last: [...eventIds].at(-1) }
  })
  expect(visitedRows.count).toBe(2001)
  expect(visitedRows.first).toBe(firstEventId)
  expect(visitedRows.last).toBe('synthetic-result-399:result')
  const lastRow = page.locator('.event-row[data-event-id="synthetic-result-399:result"]')
  await expect(lastRow).toBeVisible()
  const scrollInteractionMs = performance.now() - scrollStartedAt
  const bottomMountedCount = await rows.count()
  expect(bottomMountedCount).toBeLessThan(60)
  expect(await rows.last().getAttribute('data-event-id')).toBe('synthetic-result-399:result')

  const phaseMeasures = await page.evaluate(() => {
    const duration = (name: string) => performance.getEntriesByName(name, 'measure').at(-1)?.duration
    return {
      parseMs: duration('pi-session-viewer:parse-session'),
      viewMs: duration('pi-session-viewer:build-session-view'),
    }
  })
  expect(fetchMs).toBeDefined()
  expect(phaseMeasures.parseMs).toBeDefined()
  expect(phaseMeasures.viewMs).toBeDefined()
  expect(browserErrors).toEqual([])
  console.info('timeline performance observations (ms)', JSON.stringify({
    fetchMs,
    parseMs: phaseMeasures.parseMs,
    viewMs: phaseMeasures.viewMs,
    firstRenderMs,
    selectionInspectorMs,
    scrollInteractionMs,
    initialMountedCount,
    bottomMountedCount,
  }))
})
