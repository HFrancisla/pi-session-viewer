import { performance } from 'node:perf_hooks'
import { expect, test } from '@playwright/test'

const cwd = '/synthetic/project'
const sessionToken = 'synthetic-large-session'
const sessionTimestamp = '2026-01-01T00:00:00.000Z'

function syntheticSession(subagentIndex?: number, requestPrefix = 'Synthetic request', includeAlternateBranch = false) {
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
    const isSubagent = index === subagentIndex
    const childSessionPath = 'subagent-artifacts/synthetic-child.jsonl'
    const longText = index % 3 === 0 ? ` ${'Additional response detail '.repeat(10)}` : ''

    if (index === 399 && includeAlternateBranch) {
      entries.push({
        type: 'message',
        id: 'synthetic-alt-user',
        parentId: 'synthetic-result-398',
        timestamp,
        message: { role: 'user', timestamp: Date.parse(timestamp), content: 'Synthetic alternate request' },
      })
      entries.push({
        type: 'message',
        id: 'synthetic-alt-assistant',
        parentId: 'synthetic-alt-user',
        timestamp,
        message: { role: 'assistant', timestamp: Date.parse(timestamp), content: [{ type: 'text', text: 'Synthetic alternate response' }] },
      })
      entries.push({
        type: 'message',
        id: 'synthetic-alt-result',
        parentId: 'synthetic-alt-assistant',
        timestamp,
        message: { role: 'toolResult', timestamp: Date.parse(timestamp), toolCallId: 'synthetic-alt-call', toolName: 'bash', content: [{ type: 'text', text: 'Synthetic alternate result' }] },
      })
    }

    entries.push({
      type: 'message',
      id: userId,
      parentId,
      timestamp,
      message: {
        role: 'user',
        timestamp: Date.parse(timestamp),
        content: `${requestPrefix} ${index + 1}`,
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
          {
            type: 'toolCall',
            id: callId,
            name: isSubagent ? 'subagent' : 'bash',
            arguments: isSubagent
              ? { agent: 'synthetic-agent', task: 'Inspect the synthetic parent', sessionFile: childSessionPath }
              : { command: `printf ${index + 1}` },
          },
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
        toolName: isSubagent ? 'subagent' : 'bash',
        isError: false,
        content: [{
          type: 'text',
          text: isSubagent ? JSON.stringify({ sessionFile: childSessionPath }) : `Synthetic result ${index + 1}`,
        }],
      },
    })
    parentId = resultId
  }

  if (subagentIndex != null) {
    for (const [id, content] of [
      ['synthetic-historical-branch', 'Historical branch reply'],
      ['synthetic-current-tip', 'Current branch reply'],
    ]) {
      entries.push({
        type: 'message',
        id,
        parentId: 'synthetic-result-399',
        timestamp: '2026-01-02T00:00:00.000Z',
        message: { role: 'assistant', timestamp: Date.parse('2026-01-02T00:00:00.000Z'), content },
      })
    }
  }

  return entries.map((entry) => JSON.stringify(entry)).join('\n')
}

test('virtualizes and preserves a 2,000-event grouped timeline', async ({ page }) => {
  const content = syntheticSession(undefined, 'Synthetic request', true)
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

  const timestampedEvent = page.locator('.event-row[data-event-id="synthetic-user-0:user"]')
  const eventClockLabel = (await timestampedEvent.locator('.event-time > span').innerText()).trim()
  await expect(timestampedEvent).toHaveAttribute('aria-label', new RegExp(`at ${eventClockLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  await page.getByRole('button', { name: 'EN / 中' }).click()
  await expect(timestampedEvent).toHaveAttribute('aria-label', new RegExp(`时间 ${eventClockLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  await page.getByRole('button', { name: 'EN / 中' }).click()

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

  const scrollContainer = page.locator('.timeline-scroll')
  const scrollToEvent = async (eventId: string) => {
    return scrollContainer.evaluate(async (element, targetId) => {
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const targetSelector = `[data-event-id="${targetId}"]`
      element.scrollTop = 0
      await nextFrame()
      await nextFrame()

      let previousMaxScroll = -1
      let stableBottomFrames = 0
      for (let frame = 0; frame < 1200; frame += 1) {
        const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
        element.scrollTop = Math.min(element.scrollTop + 450, maxScroll)
        await nextFrame()
        await nextFrame()

        const row = element.querySelector<HTMLElement>(targetSelector)
        if (row) {
          const viewport = element.getBoundingClientRect()
          const viewportTop = viewport.top + element.clientTop
          const viewportBottom = viewportTop + element.clientHeight
          const rowBounds = row.getBoundingClientRect()
          if (rowBounds.bottom > viewportTop && rowBounds.top < viewportBottom) return true
        }

        const updatedMaxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
        if (element.scrollTop >= updatedMaxScroll - 1 && Math.abs(updatedMaxScroll - previousMaxScroll) < 1) {
          stableBottomFrames += 1
        } else {
          stableBottomFrames = 0
        }
        if (stableBottomFrames >= 6) return false
        previousMaxScroll = updatedMaxScroll
      }
      return false
    }, eventId)
  }

  const selectedThinking = page.locator('.event-row[data-event-id="synthetic-assistant-250:thinking:1"]')
  expect(await scrollToEvent('synthetic-assistant-250:thinking:1')).toBe(true)
  await selectedThinking.scrollIntoViewIfNeeded()
  await expect(selectedThinking).toBeVisible()
  await expect(selectedThinking).toBeInViewport()
  const firstThinkingBounds = await selectedThinking.boundingBox()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  const stableThinkingBounds = await selectedThinking.boundingBox()
  expect(firstThinkingBounds).not.toBeNull()
  expect(stableThinkingBounds).not.toBeNull()
  expect(Math.abs(stableThinkingBounds!.y - firstThinkingBounds!.y)).toBeLessThan(1)
  await selectedThinking.click()
  await expect(page.locator('.inspector')).toContainText('Synthetic reasoning 251')
  await scrollContainer.evaluate((element) => { element.scrollTop = 0 })
  const thinkingFilter = page.getByLabel('Thinking', { exact: true })
  const toggleAllButton = page.locator('.filter-select-all')
  await toggleAllButton.click()
  await expect(selectedThinking).toHaveCount(0)
  await expect(page.getByText('Select at least one event type.')).toBeVisible()
  await expect(page.locator('.inspector')).toContainText('Synthetic reasoning 251')
  await page.getByRole('button', { name: 'Show in timeline', exact: true }).click()
  await expect(thinkingFilter).toBeChecked()
  await expect(page.getByText('Select at least one event type.')).toHaveCount(0)
  await expect(selectedThinking).toBeVisible()
  await expect(selectedThinking).toHaveClass(/is-selected/)

  const sharedEvent = selectedThinking
  await page.locator('#branch-select').selectOption({ label: 'Historical branch 1' })
  await expect(sharedEvent).toHaveClass(/is-selected/)
  await expect(page.locator('.inspector')).toContainText('Synthetic reasoning 251')

  await page.locator('#branch-select').selectOption({ label: 'Current branch' })
  await page.getByLabel('Pi Response', { exact: true }).check()
  const branchOnlyEvent = page.locator('.event-row[data-event-id="synthetic-assistant-399:assistant:0"]')
  expect(await scrollToEvent('synthetic-assistant-399:assistant:0')).toBe(true)
  await expect(branchOnlyEvent).toBeVisible()
  await branchOnlyEvent.click()
  await expect(page.locator('.inspector')).toContainText('Synthetic assistant response 400.')
  await page.locator('#branch-select').selectOption({ label: 'Historical branch 1' })
  const firstVisibleEvent = page.locator(`.event-row[data-event-id="${firstEventId}"]`)
  await expect(firstVisibleEvent).toBeVisible()
  await expect(firstVisibleEvent).toHaveClass(/is-selected/)
  await page.locator('#branch-select').selectOption({ label: 'Current branch' })
  await toggleAllButton.click()
  await expect(toggleAllButton).toHaveText('Clear')

  const scrollStartedAt = performance.now()
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
    return { count: eventIds.size, ids: [...eventIds], first: eventIds.values().next().value, last: [...eventIds].at(-1) }
  })
  const expectedEventIds = ['missing-system-prompt:synthetic-user-0', ...Array.from({ length: 400 }, (_, index) => [
    `synthetic-user-${index}:user`,
    `synthetic-assistant-${index}:assistant:0`,
    `synthetic-assistant-${index}:thinking:1`,
    `synthetic-assistant-${index}:tool:2`,
    `synthetic-result-${index}:result`,
  ]).flat()]
  const visitedEventIds = new Set(visitedRows.ids)
  expect(visitedRows.count).toBe(2001)
  expect([...visitedEventIds].sort()).toEqual(expectedEventIds.sort())
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

test('keeps the large virtualized timeline reachable without horizontal overflow on mobile', async ({ page }) => {
  const content = syntheticSession(undefined, 'Synthetic request', true)
  await page.setViewportSize({ width: 390, height: 844 })
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
  await expect(page.locator('.branch-bar')).toContainText('2001 visible events')
  const scrollContainer = page.locator('.timeline-scroll')
  const rows = scrollContainer.locator('.event-row')
  const firstEventId = 'missing-system-prompt:synthetic-user-0'
  const lastEventId = 'synthetic-result-399:result'
  await expect(rows.first()).toHaveAttribute('data-event-id', firstEventId)
  expect(await rows.count()).toBeLessThan(60)

  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth)
  expect(mobileLayout.bodyWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth)

  const lastEventReachable = await scrollContainer.evaluate(async (element, eventIds) => {
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    element.scrollTop = 0
    await nextFrame()
    const firstRow = element.querySelector<HTMLElement>(`[data-event-id="${eventIds.first}"]`)
    if (!firstRow) return false

    let previousMaxScroll = -1
    let stableBottomFrames = 0
    for (let frame = 0; frame < 1200; frame += 1) {
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
      element.scrollTop = Math.min(element.scrollTop + 600, maxScroll)
      await nextFrame()
      await nextFrame()

      const row = element.querySelector<HTMLElement>(`[data-event-id="${eventIds.last}"]`)
      if (row) {
        const viewport = element.getBoundingClientRect()
        const viewportTop = viewport.top + element.clientTop
        const viewportBottom = viewportTop + element.clientHeight
        const rowBounds = row.getBoundingClientRect()
        if (rowBounds.bottom > viewportTop && rowBounds.top < viewportBottom) return true
      }

      const updatedMaxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
      if (element.scrollTop >= updatedMaxScroll - 1 && Math.abs(updatedMaxScroll - previousMaxScroll) < 1) {
        stableBottomFrames += 1
      } else {
        stableBottomFrames = 0
      }
      if (stableBottomFrames >= 6) return false
      previousMaxScroll = updatedMaxScroll
    }
    return false
  }, { first: firstEventId, last: lastEventId })
  expect(lastEventReachable).toBe(true)
  await expect(rows.last()).toHaveAttribute('data-event-id', lastEventId)
  expect(await rows.count()).toBeLessThan(60)
})

test('restores a large parent timeline anchor after subagent navigation', async ({ page }) => {
  const parentToken = 'synthetic-large-parent'
  const secondToken = 'synthetic-large-second'
  const childPath = 'subagent-artifacts/synthetic-child.jsonl'
  const childToken = Buffer.from(childPath).toString('base64url')
  const parentContent = syntheticSession(220, 'Parent synthetic request')
  const secondContent = syntheticSession(undefined, 'Second synthetic request')
  const childContent = [
    JSON.stringify({ type: 'session', version: 3, id: 'synthetic-child', timestamp: sessionTimestamp, cwd }),
    JSON.stringify({
      type: 'message',
      id: 'synthetic-child-user',
      parentId: null,
      timestamp: sessionTimestamp,
      message: { role: 'user', timestamp: Date.parse(sessionTimestamp), content: 'Synthetic child request' },
    }),
  ].join('\n')
  const sessions = [
    {
      token: parentToken,
      id: parentToken,
      title: 'Synthetic large parent',
      cwd,
      timestamp: '2026-12-31T00:00:00.000Z',
      modifiedAt: '2026-12-31T00:00:00.000Z',
      relativePath: 'synthetic-large-parent.jsonl',
    },
    {
      token: secondToken,
      id: secondToken,
      title: 'Synthetic second conversation',
      cwd,
      timestamp: '2026-12-30T00:00:00.000Z',
      modifiedAt: '2026-12-30T00:00:00.000Z',
      relativePath: 'synthetic-large-second.jsonl',
    },
    ...Array.from({ length: 398 }, (_, index) => ({
      token: `synthetic-catalog-${index + 1}`,
      id: `synthetic-catalog-${index + 1}`,
      title: `Synthetic catalog session ${index + 1}`,
      cwd,
      timestamp: sessionTimestamp,
      modifiedAt: sessionTimestamp,
      relativePath: `synthetic-catalog-${index + 1}.jsonl`,
    })),
  ]

  await page.route('**/api/sessions', async (route) => {
    await route.fulfill({ json: { root: '/synthetic/sessions', currentCwd: cwd, warnings: [], sessions } })
  })
  await page.route('**/api/sessions/*', async (route) => {
    const token = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '')
    const content = token === parentToken
      ? parentContent
      : token === secondToken
        ? secondContent
        : token === childToken
          ? childContent
          : undefined
    if (!content) {
      await route.fulfill({ status: 404, json: { error: 'Synthetic session not found' } })
      return
    }

    const relativePath = token === childToken
      ? childPath
      : token === secondToken
        ? 'synthetic-large-second.jsonl'
        : 'synthetic-large-parent.jsonl'
    await route.fulfill({ json: { token, relativePath, modifiedAt: sessionTimestamp, content } })
  })

  await page.goto('/#token=dev-token')
  const sessionList = page.locator('.session-list')
  const parentSession = sessionList.locator('.session-item').filter({ hasText: 'Synthetic large parent' })
  await expect(parentSession).toBeVisible()
  expect(await sessionList.locator('.session-item').count()).toBeLessThan(60)
  await parentSession.click()
  await expect(page.locator('.header-session strong')).toHaveText('Parent synthetic request 1')
  await expect(page.locator('#branch-select option')).toHaveCount(2)
  await page.locator('#branch-select').selectOption({ label: 'Historical branch 1' })
  await expect(page.locator('.branch-bar')).toContainText('2002 visible events')

  await page.getByLabel('Thinking', { exact: true }).uncheck()
  const scrollContainer = page.locator('.timeline-scroll')
  const anchorRowId = 'synthetic-result-220:result'
  const reachedSubagent = await scrollContainer.evaluate(async (element, targetId) => {
    const selector = `.event-row[data-event-id="${targetId}"]`
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const maxScroll = element.scrollHeight - element.clientHeight
    for (let scrollTop = 0; scrollTop <= maxScroll; scrollTop += 450) {
      element.scrollTop = scrollTop
      await frame()
      await frame()
      const target = element.querySelector<HTMLElement>(selector)
      if (target) {
        const viewportTop = element.getBoundingClientRect().top + element.clientTop
        element.scrollTop += target.getBoundingClientRect().top - viewportTop - 180
        await frame()
        await frame()
        return true
      }
    }
    return false
  }, anchorRowId)
  expect(reachedSubagent).toBe(true)
  const subagentRow = scrollContainer.locator(`.event-row[data-event-id="${anchorRowId}"]`)
  await expect(subagentRow.locator('.event-subagent-tag')).toBeVisible()

  const parentAnchor = await scrollContainer.evaluate((element) => {
    const viewport = element.getBoundingClientRect()
    const viewportTop = viewport.top + element.clientTop
    const viewportBottom = viewportTop + element.clientHeight
    const firstVisible = [...element.querySelectorAll<HTMLElement>('.event-row')].find((row) => {
      const rect = row.getBoundingClientRect()
      return rect.bottom > viewportTop && rect.top < viewportBottom
    })
    if (!firstVisible?.dataset.eventId) return null
    return {
      eventId: firstVisible.dataset.eventId,
      offset: firstVisible.getBoundingClientRect().top - viewportTop,
    }
  })
  expect(parentAnchor).not.toBeNull()

  await subagentRow.locator('.event-subagent-tag').click()
  await expect(page.getByRole('button', { name: 'Back to parent session' })).toBeVisible()
  await expect(page.locator('.header-session--breadcrumbs')).toContainText('Synthetic child request')
  await page.getByRole('button', { name: 'Back to parent session' }).click()

  const restoredAnchor = scrollContainer.locator(`.event-row[data-event-id="${parentAnchor!.eventId}"]`)
  await expect(restoredAnchor).toBeAttached()
  await expect.poll(async () => scrollContainer.evaluate((element, anchor) => {
    const viewport = element.getBoundingClientRect()
    const viewportTop = viewport.top + element.clientTop
    const row = element.querySelector<HTMLElement>(`.event-row[data-event-id="${anchor.eventId}"]`)
    return row ? Math.abs(row.getBoundingClientRect().top - viewportTop - anchor.offset) : Number.POSITIVE_INFINITY
  }, parentAnchor!)).toBeLessThanOrEqual(2)
  await expect(page.locator('#branch-select')).toHaveValue('synthetic-historical-branch')
  expect(await page.getByLabel('Thinking', { exact: true }).isChecked()).toBe(false)

  await sessionList.locator('.session-item').filter({ hasText: 'Synthetic second conversation' }).click()
  await expect(page.locator('.header-session strong')).toHaveText('Second synthetic request 1')
  await expect.poll(() => scrollContainer.evaluate((element) => element.scrollTop)).toBeLessThan(5)
  await expect(scrollContainer.locator('.event-row').first()).toHaveAttribute('data-event-id', 'missing-system-prompt:synthetic-user-0')
})
