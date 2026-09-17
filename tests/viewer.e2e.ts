import { expect, test } from '@playwright/test'

test('requires an instance token before requesting session data', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiRequests.push(request.url())
  })

  await page.goto('/')

  await expect(page.getByRole('alert')).toContainText('Missing panel access token')
  expect(apiRequests).toEqual([])
})

test('browses a Pi session end to end on desktop and narrow screens', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('/#token=dev-token')
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/)
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  const faviconResponse = await page.request.get('/favicon.svg')
  expect(faviconResponse.status()).toBe(200)
  expect(faviconResponse.headers()['content-type']).toContain('image/svg+xml')
  await expect(page.getByText('工具配对演示', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.event-row')).toHaveCount(12)
  const llmOutput = page.locator('.llm-output-group')
  await expect(llmOutput).toHaveCount(1)
  await expect(llmOutput.locator('.llm-output-header')).toHaveCount(0)
  await expect(llmOutput.locator('.event-row')).toHaveCount(4)
  await expect(llmOutput.locator('.event--tool-result')).toHaveCount(0)
  await expect(page.locator('.filter-kind-icon')).toHaveCount(8)
  await expect(page.locator('.filter-swatch')).toHaveCount(0)
  const colorMismatches = await page.locator('.event-row').evaluateAll((rows) => rows
    .map((row) => {
      const title = row.querySelector('.event-title-line strong')
      const icon = row.querySelector('.track-dot')
      return title && icon && getComputedStyle(title).color !== getComputedStyle(icon).color
    })
    .filter(Boolean).length)
  expect(colorMismatches).toBe(0)
  await expect(page.locator('.warning-strip')).toContainText('1 parse warning')
  await expect(page.locator('#branch-select option')).toHaveCount(2)
  await page.locator('#branch-select').selectOption({ label: '旧尝试' })
  await expect(page.getByText('旧分支回复', { exact: true })).toBeVisible()
  await page.locator('#branch-select').selectOption({ label: 'Current branch' })
  await expect(page.getByText('当前分支回复', { exact: true })).toBeVisible()

  const firstTurnEvents = page.locator('.turn-group').nth(1).locator('.event-row')
  await expect(firstTurnEvents.first()).toHaveClass(/event--system-prompt/)
  await expect(firstTurnEvents.first().locator('.event-char-count')).toContainText('chars')
  await expect(firstTurnEvents.nth(1)).toHaveClass(/event--tool-definitions/)
  await expect(firstTurnEvents.nth(1).locator('.event-summary')).toContainText('Mounted')
  await expect(firstTurnEvents.nth(1).locator('.event-summary')).not.toContainText('chars')
  await expect(firstTurnEvents.nth(2)).toHaveClass(/event--user/)
  await expect(firstTurnEvents.nth(2).locator('.event-char-count')).toContainText('chars')

  await firstTurnEvents.nth(1).click()
  const inspector = page.locator('.inspector')
  await expect(page.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.tool-definitions-view details')).toHaveCount(1)
  await expect(page.locator('.tool-definitions-view details')).not.toHaveAttribute('open', '')
  await page.locator('.tool-definitions-view summary').click()
  await expect(page.locator('.tool-definitions-view .content-body-wrap.event--tool-definitions')).toBeVisible()
  await expect(page.locator('.tool-definitions-view pre')).toContainText('"command"')

  await firstTurnEvents.first().click()
  await expect(page.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.content-view pre')).toContainText('You are an expert coding assistant.')
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(inspector).toContainText('Relative Gap')
  await expect(inspector).not.toContainText('Duration')
  await page.getByRole('tab', { name: 'Content' }).click()
  await page.getByRole('tab', { name: 'Composition' }).click()
  await page.locator('.prompt-composition details').first().locator('summary').click()
  await expect(page.locator('.prompt-composition .content-body-wrap.event--system-prompt').first()).toBeVisible()
  await expect(page.locator('.prompt-composition')).toContainText('/work/demo/AGENTS.md')
  await expect(page.locator('.prompt-composition')).toContainText('tdd')
  await expect(page.getByRole('tab', { name: 'Tool Definitions' })).toHaveCount(0)

  const testCall = page.locator('.event--tool-call').filter({ hasText: 'npm test' })
  await testCall.click()

  const rowsAlignment = await page.evaluate(() => {
    const summary = document.querySelector('.session-summary')?.getBoundingClientRect()
    const heading = document.querySelector('.inspector-heading')?.getBoundingClientRect()
    const filterBar = document.querySelector('.filter-bar')?.getBoundingClientRect()
    const inspectorTabs = document.querySelector('.inspector-tabs')?.getBoundingClientRect()
    const branchBar = document.querySelector('.branch-bar')?.getBoundingClientRect()
    const contentToolbar = document.querySelector('.content-header-toolbar')?.getBoundingClientRect()
    return {
      row1: {
        summaryHeight: summary?.height,
        headingHeight: heading?.height,
      },
      row2: {
        filterTop: filterBar?.top,
        tabsTop: inspectorTabs?.top,
        filterHeight: filterBar?.height,
        tabsHeight: inspectorTabs?.height,
      },
      row3: {
        branchTop: branchBar?.top,
        toolbarTop: contentToolbar?.top,
        branchHeight: branchBar?.height,
        toolbarHeight: contentToolbar?.height,
      },
    }
  })
  expect(Math.abs((rowsAlignment.row1.headingHeight ?? 0) - (rowsAlignment.row1.summaryHeight ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((rowsAlignment.row2.tabsTop ?? 0) - (rowsAlignment.row2.filterTop ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((rowsAlignment.row2.tabsHeight ?? 0) - (rowsAlignment.row2.filterHeight ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((rowsAlignment.row3.toolbarTop ?? 0) - (rowsAlignment.row3.branchTop ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((rowsAlignment.row3.toolbarHeight ?? 0) - (rowsAlignment.row3.branchHeight ?? 0))).toBeLessThanOrEqual(1)

  await expect(page.locator('.content-view .content-header-tokens')).toContainText('chars')
  await expect(page.locator('.content-view .content-header-tokens')).not.toContainText('tokens')
  await expect(page.locator('.content-view .inspector-action-btn')).toHaveText('Copy')

  await page.getByRole('tab', { name: 'Raw' }).click()
  await expect(page.locator('.raw-view .content-body-wrap.event--tool-call')).toBeVisible()
  await expect(page.locator('.content-view pre')).toContainText('"name": "bash"')
  await expect(page.locator('.raw-view .content-header-tokens')).toContainText('ID:')
  await expect(page.locator('.raw-view .inspector-action-btn')).toHaveText('Copy')
  await expect(page.locator('.event--tool-result').first()).toContainText('Success')

  const laneGeometry = await page.evaluate(() => {
    const laneX = (callId: string, phase: 'start' | 'end') => {
      const rail = document.querySelector<HTMLElement>(`.causal-rail--${phase}[data-call-id="${callId}"]`)
      if (!rail) throw new Error(`Missing ${phase} rail for ${callId}`)
      return rail.getBoundingClientRect().left
    }
    return {
      first: { start: laneX('call-1', 'start'), end: laneX('call-1', 'end') },
      second: { start: laneX('call-2', 'start'), end: laneX('call-2', 'end') },
    }
  })
  expect(Math.abs(laneGeometry.first.start - laneGeometry.first.end)).toBeLessThanOrEqual(1)
  expect(Math.abs(laneGeometry.second.start - laneGeometry.second.end)).toBeLessThanOrEqual(1)
  expect(Math.abs(laneGeometry.first.start - laneGeometry.second.start)).toBeGreaterThanOrEqual(6)

  const thinkingFilter = page.getByLabel('Thinking', { exact: true })
  await thinkingFilter.uncheck()
  await expect(page.locator('.event--thinking')).toHaveCount(0)
  await thinkingFilter.check()
  await expect(page.locator('.event--thinking')).toHaveCount(1)

  const toggleAllButton = page.locator('.filter-select-all')
  await expect(toggleAllButton).toHaveText('Clear')
  const unselectWidth = await toggleAllButton.evaluate((el) => el.getBoundingClientRect().width)

  await toggleAllButton.click()
  await expect(toggleAllButton).toHaveText('Select All')
  const selectWidth = await toggleAllButton.evaluate((el) => el.getBoundingClientRect().width)
  expect(selectWidth).toBeGreaterThan(0)

  await expect(thinkingFilter).not.toBeChecked()
  await expect(page.locator('.event--thinking')).toHaveCount(0)
  await expect(page.getByText('Select at least one event type.')).toBeVisible()

  await toggleAllButton.click()
  await expect(toggleAllButton).toHaveText('Clear')
  await expect(thinkingFilter).toBeChecked()
  await expect(page.locator('.event--thinking')).toHaveCount(1)

  const userFilter = page.getByLabel('User', { exact: true })
  await userFilter.uncheck()
  await expect(toggleAllButton).toHaveText('Select All')
  await toggleAllButton.click()
  await expect(toggleAllButton).toHaveText('Clear')
  await expect(userFilter).toBeChecked()
  await expect(page.locator('.event--user')).toHaveCount(1)

  const columns = await page.locator('.session-sidebar, .main-stage, .inspector').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return { left: box.left, right: box.right }
  }))
  expect(columns[0].right).toBeLessThanOrEqual(columns[1].left + 1)
  expect(columns[1].right).toBeLessThanOrEqual(columns[2].left + 1)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open session list', exact: true }).click()
  await expect(page.locator('.sidebar-layer')).toHaveClass(/is-open/)
  await page.getByRole('button', { name: 'Close overlay' }).click({ position: { x: 380, y: 300 } })
  await page.getByRole('button', { name: 'Open details', exact: true }).click()
  await expect(page.locator('.inspector')).toHaveClass(/is-mobile-open/)

  const viewport = await page.evaluate(() => ({ documentWidth: document.body.scrollWidth, viewportWidth: innerWidth }))
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth)
  expect(browserErrors).toEqual([])
})

test('switches language to Chinese via header toggle and persists preference', async ({ page }) => {
  await page.goto('/#token=dev-token')
  await expect(page.locator('.warning-strip')).toContainText('1 parse warning')
  const langToggle = page.getByRole('button', { name: 'EN / 中' })
  await expect(langToggle).toBeVisible()

  // Toggle language to Chinese
  await langToggle.click()

  // Verify UI switched to Chinese
  await expect(page.locator('.warning-strip')).toContainText('1 条解析警告')
  await expect(page.getByRole('tab', { name: '内容' })).toBeVisible()
  await expect(page.locator('.filter-select-all')).toHaveText('全不选')
  await expect(page.locator('.content-view .inspector-action-btn')).toHaveText('复制')

  // Verify persistence in localStorage
  const savedLocale = await page.evaluate(() => localStorage.getItem('pi_session_viewer_locale'))
  expect(savedLocale).toBe('zh-CN')

  // Reload page and confirm persisted preference remains Chinese
  await page.reload()
  await expect(page.locator('.warning-strip')).toContainText('1 条解析警告')
  await expect(page.locator('.filter-select-all')).toHaveText('全不选')
  await expect(page.locator('.content-view .inspector-action-btn')).toHaveText('复制')

  // Toggle back to English
  await page.getByRole('button', { name: 'EN / 中' }).click()
  await expect(page.locator('.warning-strip')).toContainText('1 parse warning')
  await expect(page.locator('.filter-select-all')).toHaveText('Clear')
  const backLocale = await page.evaluate(() => localStorage.getItem('pi_session_viewer_locale'))
  expect(backLocale).toBe('en')
})
