import { expect, test } from '@playwright/test'

test('keeps the workspace inside the viewport at supported desktop widths', async ({ page }) => {
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()

  for (const width of [1024, 1180, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 850 })
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
      inspectorPosition: getComputedStyle(document.querySelector('.inspector')!).position,
    }))
    expect(geometry.content, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(geometry.viewport)
    expect(geometry.inspectorPosition).toBe('static')
  }
})

test('makes every inspector tab usable on desktop and supports arrow-key navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 740 })
  await page.goto('/#token=dev-token')
  await page.locator('.event-row').first().click()

  for (const name of ['Overview', 'Composition', 'Content', 'Diff', 'Raw']) {
    const tab = page.getByRole('tab', { name, exact: true })
    await expect(tab).toBeVisible()
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(tab).toHaveAttribute('aria-controls', 'inspector-tabpanel')
    await expect(page.locator('#inspector-tabpanel')).toHaveAttribute('aria-labelledby', await tab.getAttribute('id') ?? '')
  }

  await page.getByRole('tab', { name: 'Content' }).click()
  await page.getByRole('tab', { name: 'Content' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'Raw' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
})

test('shows event metadata, the session title, and Diff actions without clipping', async ({ page }) => {
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()

  for (const width of [1024, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.header-session-info')).toContainText('工具配对演示')
    const clippedMetadata = await page.locator('.event-char-count, .event-context-mark').evaluateAll((elements) =>
      elements.filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && (rect.left < 0 || rect.right > innerWidth + 1)
      }).map((element) => element.textContent),
    )
    expect(clippedMetadata, `clipped event metadata at ${width}px`).toEqual([])

    await page.locator('.event-row').first().click()
    await page.getByRole('tab', { name: 'Diff' }).click()
    const toolbarBounds = await page.locator('.diff-view .content-header-toolbar').evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }))
    expect(toolbarBounds.scroll).toBeLessThanOrEqual(toolbarBounds.client)
    await expect(page.getByRole('button', { name: 'Copy Diff' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Baseline' })).toBeVisible()
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('.event-row').first().click()
  await page.getByRole('tab', { name: 'Diff' }).click()
  const desktopToolbar = page.locator('.diff-view .content-header-toolbar')
  expect(await desktopToolbar.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    await desktopToolbar.evaluate((element) => element.clientWidth),
  )
})

test('preserves the last session and provides a dismissible error when JSONL import fails', async ({ page }) => {
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  const originalTitle = await page.locator('.header-session strong').first().innerText()

  await page.locator('input[type="file"]').setInputFiles({
    name: 'invalid.jsonl',
    mimeType: 'application/json',
    buffer: Buffer.from('not a Pi session'),
  })

  const error = page.locator('.main-stage .action-error-strip[role="alert"]')
  await expect(error).toContainText('This file does not contain a Pi Session header')
  await expect(page.locator('.header-session strong').first()).toHaveText(originalTitle)
  await expect(page.locator('.event-row').first()).toBeVisible()
  await expect(page.locator('.inspector')).toContainText('Model Switch')
  await error.getByRole('button', { name: 'Dismiss' }).click()
  await expect(error).toHaveCount(0)
})

test('keeps filtering controls discoverable and shows a copy error when clipboard access is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('Clipboard access denied') } },
    })
  })
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Current Project (1)' })).toHaveText('Current (1)')
  await expect(page.getByRole('button', { name: 'Select All' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Event filter' }).getByRole('checkbox')).toHaveCount(8)

  await page.locator('.header-session .header-path-copy').click()
  await expect(page.locator('.copy-status-toast')).toHaveText('Copy failed')
  await page.locator('.event-row').first().click()
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveAttribute('data-copy-status', 'error')
  await expect(page.locator('.copy-status-toast')).toHaveCount(1)
  await expect(page.locator('.header-path-copy')).toHaveAttribute('data-copy-status', 'idle')
  await page.getByRole('tab', { name: 'Diff' }).click()
  await expect(page.locator('.copy-status-toast')).toHaveCount(0)
  await page.getByRole('button', { name: 'Copy Diff' }).click()
  await expect(page.getByRole('button', { name: 'Copy Diff' })).toHaveAttribute('data-copy-status', 'error')
})

test('wraps import errors and keeps the branch label legible at minimum desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 740 })
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  const branch = page.locator('#branch-select')
  expect(await branch.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(140)
  await expect(page.locator('.event-time').first()).toHaveCSS('font-size', '11px')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'invalid.jsonl', mimeType: 'application/json', buffer: Buffer.from('not a Pi session'),
  })
  const error = page.locator('.action-error-strip')
  await expect(error).toContainText('This file does not contain a Pi Session header')
  const measurements = await error.locator('span').evaluate((element) => ({
    contentWidth: element.scrollWidth, visibleWidth: element.clientWidth, whiteSpace: getComputedStyle(element).whiteSpace,
  }))
  expect(measurements.whiteSpace).not.toBe('nowrap')
  expect(measurements.contentWidth).toBeLessThanOrEqual(measurements.visibleWidth + 1)
  const closeButton = error.getByRole('button', { name: 'Dismiss' })
  expect(await closeButton.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(32)
  await closeButton.click()
  await expect(error).toHaveCount(0)
})

test('shows a direct offline JSONL entry point when the panel token is missing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 })
  const apiCalls: string[] = []
  page.on('request', (request) => { if (request.url().includes('/api/')) apiCalls.push(request.url()) })
  await page.goto('/')
  await expect(page.locator('.load-state h1')).toHaveText('Panel access token required')
  await expect(page.locator('.load-state-actions')).toContainText('offline')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'invalid.jsonl', mimeType: 'application/json', buffer: Buffer.from('invalid'),
  })
  await expect(page.locator('.load-state h1')).toHaveText('Failed to open session')
  await expect(page.locator('.load-state')).toContainText('This file does not contain a Pi Session header')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.load-state-actions').getByRole('button', { name: 'Open JSONL' }).click(),
  ])
  await chooser.setFiles('tests/fixtures/sessions/demo/demo.jsonl')
  await expect(page.locator('.event-row').first()).toBeVisible()
  await expect(page.locator('.load-state')).toHaveCount(0)
  expect(apiCalls).toEqual([])
})

test('uses a clear stats hierarchy, quieter metadata, and singular catalog copy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  await expect(page.locator('.sidebar-heading p')).toHaveText('1 record · 1 total')
  await expect(page.locator('.session-summary > div').first().locator('strong')).toHaveCSS('font-size', '18px')
  await expect(page.locator('.session-summary > div').last().locator('strong')).toHaveCSS('font-size', '13px')
  await expect(page.locator('.event-char-count').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await page.setViewportSize({ width: 1024, height: 740 })
  const metrics = await page.evaluate(() => ({ viewport: innerWidth, pageWidth: document.documentElement.scrollWidth }))
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewport)
})


test('shows the complete unstructured prompt without invented composition sections', async ({ page }) => {
  const prompt = '  Available tools:\n- bash: Execute commands\n\nGuidelines:\n- Use tests first\n '
  const timestamp = '2026-01-01T10:00:00.000Z'
  const lines = [
    { type: 'session', version: 3, id: 'raw-prompt-session', timestamp, cwd: '/work/demo' },
    { type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', content: 'Hello', timestamp: 1767261600000 } },
    { type: 'custom', id: 'prompt', parentId: 'user', timestamp, customType: 'pi-session-viewer.system-prompt', data: {
      schemaVersion: 1, recordType: 'snapshot', captureStage: 'agent_start', targetUserEntryId: 'user', messageType: 'user', prompt,
      composition: { cwd: '/work/demo', skills: [{ name: 'example', description: 'Example skill', filePath: '/skills/example/SKILL.md' }] },
    } },
  ].map((entry) => JSON.stringify(entry)).join('\n')
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({ name: 'raw-prompt.jsonl', mimeType: 'application/json', buffer: Buffer.from(lines) })
  await page.locator('.event-row.event--system-prompt').click()
  await page.getByRole('tab', { name: 'Composition' }).click()
  const composition = page.locator('.prompt-composition')
  await expect(composition).toContainText('no verified section structure')
  await expect(composition.locator('details')).toHaveCount(0)
  expect(await composition.locator('pre').textContent()).toBe(prompt)
})
