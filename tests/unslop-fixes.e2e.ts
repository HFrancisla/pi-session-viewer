import { expect, test } from '@playwright/test'

test('mobile drawers trap focus, support Escape, and restore focus to their opener', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()

  await expect(page.locator('.sidebar-layer')).toHaveAttribute('inert', '')
  await expect(page.locator('.inspector')).toHaveAttribute('inert', '')

  const openSessions = page.getByRole('button', { name: 'Open session list' })
  await openSessions.click()
  await expect(page.getByRole('dialog', { name: 'Sessions' })).toBeVisible()
  await expect(page.locator('.sidebar-close')).toBeFocused()
  await expect(page.locator('.main-stage')).toHaveAttribute('inert', '')
  await expect(page.locator('.app-header')).toHaveAttribute('inert', '')

  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('.import-button')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('.sidebar-close')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Sessions' })).toHaveCount(0)
  await expect(page.locator('.sidebar-layer')).toHaveAttribute('inert', '')
  await expect(openSessions).toBeFocused()

  const openDetails = page.getByRole('button', { name: 'Open details' })
  await openDetails.click()
  await expect(page.getByRole('dialog', { name: 'Details' })).toBeVisible()
  await expect(page.locator('.inspector-close')).toBeFocused()
  await expect(page.locator('.main-stage')).toHaveAttribute('inert', '')
  await page.keyboard.press('Shift+Tab')
  expect(await page.locator('.inspector').evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Details' })).toHaveCount(0)
  await expect(page.locator('.inspector')).toHaveAttribute('inert', '')
  await expect(openDetails).toBeFocused()

  // Desktop Inspector selections must not unexpectedly reopen the drawer on resize.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('.event-row').first().click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.inspector')).not.toHaveClass(/is-mobile-open/)
  await expect(page.locator('.app-header')).not.toHaveAttribute('inert')
})

test('scope tabs have keyboard navigation and a named panel', async ({ page }) => {
  await page.goto('/#token=dev-token')
  const current = page.getByRole('tab', { name: 'Current Project (1)' })
  const all = page.getByRole('tab', { name: 'All (1)' })
  const panel = page.getByRole('tabpanel', { name: 'Current Project (1)' })
  await expect(panel).toBeVisible()
  await expect(current).toHaveAttribute('aria-controls', 'sidebar-sessions-panel')
  await current.focus()
  await page.keyboard.press('ArrowRight')
  await expect(all).toBeFocused()
  await expect(all).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#sidebar-sessions-panel')).toHaveAttribute('aria-labelledby', 'sidebar-scope-all')
  await page.keyboard.press('Home')
  await expect(current).toBeFocused()
  await expect(current).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(all).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(current).toBeFocused()
})

test('filter navigation reveals hidden event types without scrolling the document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()

  const scroller = page.locator('.filter-scroller')
  const more = page.getByRole('button', { name: 'Show more event filters' })
  await expect(more).toBeVisible()
  expect(await scroller.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
    await scroller.evaluate((element) => element.clientWidth),
  )
  await more.click()
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await scroller.evaluate((element) => { element.scrollLeft = element.scrollWidth })
  await expect(page.getByRole('button', { name: 'Show previous event filters' })).toBeVisible()
  const bounds = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(bounds.content).toBeLessThanOrEqual(bounds.viewport)
})

test('catalog preserves and exposes every warning instead of silently truncating the list', async ({ page }) => {
  await page.route('**/api/sessions', async (route) => {
    const original = await (await route.fetch()).json()
    await route.fulfill({ json: { ...original, warnings: ['First path could not be read', 'Second path could not be read'] } })
  })
  await page.goto('/#token=dev-token')
  const warnings = page.locator('.sidebar-warning-list')
  await expect(warnings.locator('summary')).toHaveText('2 session catalog warnings')
  await warnings.locator('summary').click()
  await expect(warnings.locator('li')).toHaveCount(2)
  await expect(warnings).toContainText('Second path could not be read')
})

test('mobile inspector jumps and subagent choices reveal the timeline instead of covering it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  await page.locator('.event-row').first().click()
  await expect(page.getByRole('dialog', { name: 'Details' })).toBeVisible()
  await page.getByRole('button', { name: 'Show in timeline' }).click()
  await expect(page.getByRole('dialog', { name: 'Details' })).toHaveCount(0)
  await expect(page.locator('.timeline-scroll')).toBeFocused()

  const subagent = page.locator('.event-subagent-tag').first()
  await subagent.click()
  await expect(page.getByRole('dialog', { name: 'Details' })).toHaveCount(0)
  await expect(page.locator('.event-subagent-options')).toBeVisible()
  await page.locator('.event-subagent-options').getByRole('button', { name: /worker-a/ }).click()
  await expect(page.locator('.event-row.event--user .event-summary').filter({ hasText: 'Worker A child session' })).toBeVisible()
  await expect(page.locator('.inspector')).not.toHaveClass(/is-mobile-open/)
})

test('Chinese UI localizes generated metadata but not the raw transcript', async ({ page }) => {
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  await page.locator('.lang-toggle-button').click()
  await expect(page.locator('.event--tool-definitions .event-summary').first()).toContainText('挂载 1 个 API 工具')
  await expect(page.locator('.event--system-prompt .event-summary').first()).toContainText('挂载 1 个 Skill')
  await page.locator('.event-row.event--user').first().click()
  await expect(page.getByRole('tab', { name: '原始数据' })).toBeVisible()
  await expect(page.locator('.event-row.event--user .event-summary')).toContainText('检查测试是否通过')
})

test('responsive layout and missing-token guidance remain usable', async ({ page }) => {
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  for (const width of [320, 390, 640, 768, 1024, 1025, 1180, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    const geometry = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }))
    expect(geometry.page, `overflow at ${width}`).toBeLessThanOrEqual(geometry.viewport)
  }
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await expect(page.locator('.load-state h1')).toHaveText('Panel access token required')
  await expect(page.locator('.load-state')).toContainText('Run /session-viewer on from Pi')
})


test('timeline grid preserves independent subagent buttons and keyboard selection', async ({ page }) => {
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  const grid = page.getByRole('grid', { name: 'Session timeline' })
  await expect(grid.getByRole('row').first()).toBeVisible()
  const subagent = page.locator('.event-subagent-tag').first()
  await subagent.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.event-subagent-options')).toBeVisible()
  await expect(subagent).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.event-subagent-options')).toHaveCount(0)
  await grid.focus()
  await page.keyboard.press('ArrowDown')
  await expect(grid).toHaveAttribute('aria-activedescendant', /^event-row-/)
  await page.keyboard.press('Enter')
  await expect(page.locator('.inspector-heading p')).not.toHaveText('Select an event')
})

test('language switch identifies both the current and target languages', async ({ page }) => {
  await page.goto('/#token=dev-token')
  const button = page.locator('.lang-toggle-button')
  await expect(button).toHaveAttribute('aria-label', 'Language: English. Switch to Chinese')
  await button.click()
  await expect(button).toHaveAttribute('aria-label', '当前语言：中文，切换为英语')
  await button.click()
  await expect(button).toHaveAttribute('aria-label', 'Language: English. Switch to Chinese')
})
