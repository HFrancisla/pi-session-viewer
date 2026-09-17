import { expect, test } from '@playwright/test'

test('requires an instance token before requesting session data', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiRequests.push(request.url())
  })

  await page.goto('/')

  await expect(page.getByRole('alert')).toContainText('缺少面板访问令牌')
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
  await expect(page.locator('.warning-strip')).toContainText('1 条解析警告')
  await expect(page.locator('#branch-select option')).toHaveCount(2)
  await page.locator('#branch-select').selectOption({ label: '旧尝试' })
  await expect(page.getByText('旧分支回复', { exact: true })).toBeVisible()
  await page.locator('#branch-select').selectOption({ label: '当前分支' })
  await expect(page.getByText('当前分支回复', { exact: true })).toBeVisible()

  const firstTurnEvents = page.locator('.turn-group').nth(1).locator('.event-row')
  await expect(firstTurnEvents.first()).toHaveClass(/event--system-prompt/)
  await expect(firstTurnEvents.first().locator('.event-char-count')).toContainText('字符')
  await expect(firstTurnEvents.nth(1)).toHaveClass(/event--tool-definitions/)
  await expect(firstTurnEvents.nth(1).locator('.event-summary')).toContainText('已挂载')
  await expect(firstTurnEvents.nth(1).locator('.event-summary')).not.toContainText('字符')
  await expect(firstTurnEvents.nth(2)).toHaveClass(/event--user/)
  await expect(firstTurnEvents.nth(2).locator('.event-char-count')).toContainText('字符')

  await firstTurnEvents.nth(1).click()
  const inspector = page.locator('.inspector')
  await expect(page.getByRole('tab', { name: '内容' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.tool-definitions-view details')).toHaveCount(1)
  await expect(page.locator('.tool-definitions-view details')).not.toHaveAttribute('open', '')
  await page.locator('.tool-definitions-view summary').click()
  await expect(page.locator('.tool-definitions-view .content-body-wrap.event--tool-definitions')).toBeVisible()
  await expect(page.locator('.tool-definitions-view pre')).toContainText('"command"')

  await firstTurnEvents.first().click()
  await expect(page.getByRole('tab', { name: '内容' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.content-view pre')).toContainText('You are an expert coding assistant.')
  await page.getByRole('tab', { name: '概览' }).click()
  await expect(inspector).not.toContainText('距上一事件')
  await expect(inspector).not.toContainText('明确耗时')
  await page.getByRole('tab', { name: '内容' }).click()
  await page.getByRole('tab', { name: '组成' }).click()
  await page.locator('.prompt-composition details').first().locator('summary').click()
  await expect(page.locator('.prompt-composition .content-body-wrap.event--system-prompt').first()).toBeVisible()
  await expect(page.locator('.prompt-composition')).toContainText('/work/demo/AGENTS.md')
  await expect(page.locator('.prompt-composition')).toContainText('tdd')
  await expect(page.getByRole('tab', { name: '工具定义' })).toHaveCount(0)

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

  await expect(page.locator('.content-view .content-header-tokens')).toContainText('字符')
  await expect(page.locator('.content-view .content-header-tokens')).not.toContainText('tokens')
  await expect(page.locator('.content-view .inspector-action-btn')).toHaveText('复制')

  await page.getByRole('tab', { name: 'Raw' }).click()
  await expect(page.locator('.raw-view .content-body-wrap.event--tool-call')).toBeVisible()
  await expect(page.locator('.content-view pre')).toContainText('"name": "bash"')
  await expect(page.locator('.raw-view .content-header-tokens')).toContainText('ID:')
  await expect(page.locator('.raw-view .inspector-action-btn')).toHaveText('复制')
  await expect(page.locator('.event--tool-result').first()).toContainText('成功')

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
  await expect(toggleAllButton).toHaveText('全不选')
  const unselectWidth = await toggleAllButton.evaluate((el) => el.getBoundingClientRect().width)

  await toggleAllButton.click()
  await expect(toggleAllButton).toHaveText('全\u3000选')
  const selectWidth = await toggleAllButton.evaluate((el) => el.getBoundingClientRect().width)
  expect(Math.abs(unselectWidth - selectWidth)).toBeLessThanOrEqual(1)

  await expect(thinkingFilter).not.toBeChecked()
  await expect(page.locator('.event--thinking')).toHaveCount(0)
  await expect(page.getByText('至少选择一种事件类型。')).toBeVisible()

  await toggleAllButton.click()
  await expect(toggleAllButton).toHaveText('全不选')
  await expect(thinkingFilter).toBeChecked()
  await expect(page.locator('.event--thinking')).toHaveCount(1)

  const userFilter = page.getByLabel('用户', { exact: true })
  await userFilter.uncheck()
  await expect(toggleAllButton).toHaveText('全\u3000选')
  await toggleAllButton.click()
  await expect(toggleAllButton).toHaveText('全不选')
  await expect(userFilter).toBeChecked()
  await expect(page.locator('.event--user')).toHaveCount(1)

  const columns = await page.locator('.session-sidebar, .main-stage, .inspector').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return { left: box.left, right: box.right }
  }))
  expect(columns[0].right).toBeLessThanOrEqual(columns[1].left + 1)
  expect(columns[1].right).toBeLessThanOrEqual(columns[2].left + 1)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click()
  await expect(page.locator('.sidebar-layer')).toHaveClass(/is-open/)
  await page.getByRole('button', { name: '关闭浮层' }).click({ position: { x: 380, y: 300 } })
  await page.getByRole('button', { name: '打开详情', exact: true }).click()
  await expect(page.locator('.inspector')).toHaveClass(/is-mobile-open/)

  const viewport = await page.evaluate(() => ({ documentWidth: document.body.scrollWidth, viewportWidth: innerWidth }))
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth)
  expect(browserErrors).toEqual([])
})
