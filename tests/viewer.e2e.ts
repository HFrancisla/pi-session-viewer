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
  await expect(page.getByText('工具配对演示', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.event-row')).toHaveCount(11)
  const llmOutput = page.locator('.llm-output-group')
  await expect(llmOutput).toHaveCount(1)
  await expect(llmOutput.locator('.llm-output-header')).toContainText('4 个内容块')
  await expect(llmOutput.locator('.event-row')).toHaveCount(4)
  await expect(llmOutput.locator('.event--tool-result')).toHaveCount(0)
  await expect(page.locator('.filter-kind-icon')).toHaveCount(7)
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
  await page.locator('#branch-select').selectOption({ label: '当前路径' })
  await expect(page.getByText('当前分支回复', { exact: true })).toBeVisible()

  const firstTurnEvents = page.locator('.turn-group').nth(1).locator('.event-row')
  await expect(firstTurnEvents.first()).toHaveClass(/event--system-prompt/)
  await expect(firstTurnEvents.nth(1)).toHaveClass(/event--user/)
  await firstTurnEvents.first().click()
  const inspector = page.locator('.inspector')
  await expect(page.getByRole('tab', { name: '内容' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.content-view pre')).toContainText('You are an expert coding assistant.')
  await page.getByRole('tab', { name: '概览' }).click()
  await expect(inspector).not.toContainText('距上一事件')
  await expect(inspector).not.toContainText('明确耗时')
  await page.getByRole('tab', { name: '内容' }).click()
  await page.getByRole('tab', { name: '组成' }).click()
  await expect(page.locator('.prompt-composition')).toContainText('/work/demo/AGENTS.md')
  await expect(page.locator('.prompt-composition')).toContainText('tdd')

  const testCall = page.locator('.event--tool-call').filter({ hasText: 'npm test' })
  await testCall.click()
  await page.getByRole('tab', { name: 'Raw' }).click()
  await expect(page.locator('.content-view pre')).toContainText('"name": "bash"')
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
