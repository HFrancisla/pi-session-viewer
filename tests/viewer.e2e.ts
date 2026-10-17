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
  // Keep the URL with each console error so a deliberately provoked 404 can be
  // told apart from an unexpected one.
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`${message.text()} @ ${message.location().url}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`${error.message} @ `))

  await page.goto('/#token=dev-token')
  await page.setViewportSize({ width: 1280, height: 1200 })
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/)
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  const faviconResponse = await page.request.get('/favicon.svg')
  expect(faviconResponse.status()).toBe(200)
  expect(faviconResponse.headers()['content-type']).toContain('image/svg+xml')
  await expect(page.getByText('工具配对演示', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.event-row')).toHaveCount(14)
  const llmOutputStarts = page.locator('.event-row.llm-output-group-start')
  await expect(llmOutputStarts).toHaveCount(2)
  const firstGroupId = await llmOutputStarts.first().getAttribute('data-llm-output-group')
  const secondGroupId = await llmOutputStarts.nth(1).getAttribute('data-llm-output-group')
  const firstLlmOutput = page.locator(`.event-row[data-llm-output-group="${firstGroupId}"]`)
  const secondLlmOutput = page.locator(`.event-row[data-llm-output-group="${secondGroupId}"]`)
  await expect(firstLlmOutput).toHaveCount(4)
  await expect(firstLlmOutput.locator('.event--tool-result')).toHaveCount(0)
  await expect(secondLlmOutput).toHaveCount(1)
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
  // The demo session contains a failed assistant attempt that a context_edit
  // removed from the model's context. The raw record stays visible, marked.
  // The omitted entry expands into four rows (thinking, text and two tool calls);
  // every one of them is marked, and no other row is.
  const markedRows = page.locator('.event-row').filter({ has: page.locator('.event-context-mark') })
  await expect(markedRows).toHaveCount(4)
  await expect(page.locator('.event-context-mark').first()).toContainText('Not in model context')
  await expect(markedRows.filter({ hasText: 'Thinking' })).toHaveCount(1)
  await expect(markedRows.filter({ hasText: '当前分支回复' })).toHaveCount(0)
  // Turn header and branch bar report the context the model actually received.
  await expect(page.locator('.turn-context-note')).toHaveCount(1)
  await expect(page.locator('.branch-bar .context-summary')).toContainText('4 messages received')

  // Switching to the branch that still reaches that entry drops the marks.
  await page.locator('#branch-select').selectOption({ label: '旧尝试' })
  await expect(page.locator('.event-context-mark')).toHaveCount(0)
  await page.locator('#branch-select').selectOption({ label: 'Current branch' })
  await expect(page.locator('.event-context-mark')).toHaveCount(4)


  // Entry types Pi documents beyond messages: a context edit and a usage entry.
  const contextEditRow = page.locator('.event-row').filter({ hasText: 'Context Edit' })
  await expect(contextEditRow).toHaveCount(1)
  await contextEditRow.click()
  await expect(page.locator('.content-view pre')).toContainText('Target: assistant')
  await expect(page.locator('.content-view pre')).toContainText('omitted from model context')
  // The row labels its target by preview. The jump itself lives in the inspector,
  // because the row is a button and must not contain another control.
  await expect(contextEditRow.locator('.event-context-target')).toContainText('targets:')
  await expect(contextEditRow.locator('[role="button"], button')).toHaveCount(0)
  await page.locator('.inspector .inspector-action-btn', { hasText: 'Jump to target' }).click()
  await expect(page.locator('.event-row.is-selected .event-summary')).toContainText('我先检查测试结果')

  // Selecting an excluded row offers the jump back to the edit that removed it.
  const markedRow = page.locator('.event-row').filter({ has: page.locator('.event-context-mark') }).first()
  await markedRow.click()
  await page.locator('.inspector .inspector-action-btn', { hasText: 'Jump to the context edit' }).click()
  await expect(page.locator('.event-row.is-selected')).toContainText('Context Edit')

  const usageRow = page.locator('.event-row').filter({ hasText: 'Usage: cache_warm' })
  await expect(usageRow).toHaveCount(1)
  await usageRow.click()
  await expect(page.locator('.content-view pre')).toContainText('cacheRead=50000')

  const firstTurnEvents = page.locator('.event-row[data-turn-id="turn-1"]')
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
  await expect(page.locator('.content-view pre')).toContainText('You are an expert coding assistant operating inside pi')
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(inspector).toContainText('Relative Gap')
  await expect(inspector).not.toContainText('Duration')
  await page.getByRole('tab', { name: 'Content' }).click()
  await page.getByRole('tab', { name: 'Composition' }).click()
  await page.locator('.prompt-composition details').first().locator('summary').click()
  await expect(page.locator('.prompt-composition .content-body-wrap.event--system-prompt').first()).toBeVisible()
  await expect(page.locator('.prompt-composition')).toContainText('/work/demo/AGENTS.md')
  await expect(page.locator('.prompt-composition')).toContainText('tdd')

  // The demo session carries a prompt built by Pi itself, so the composition
  // panel must split it into the sections Pi sent instead of dumping the whole
  // prompt into the base template (tags included).
  const promptBlocks = page.locator('.prompt-composition .prompt-block')
  await expect(promptBlocks).toHaveCount(9)
  const blockTitles = await promptBlocks.evaluateAll((blocks) =>
    blocks.map((block) => block.querySelector('.prompt-block-title')?.textContent?.replace(/^\d+\./, '') ?? '')
  )
  expect(blockTitles).toEqual([
    'Base Template',
    'Available Tools',
    'Guidelines',
    'System Documentation',
    'Append Instructions',
    'Project Context',
    'Skills',
    'Working Directory',
    'MCP Servers',
  ])
  const blockContent = async (title: string) =>
    promptBlocks
      .filter({ has: page.locator('.prompt-block-title', { hasText: title }) })
      .locator('pre')
      .first()
      // textContent, not innerText: collapsed <details> report no innerText.
      .evaluate((element) => element.textContent ?? '')

  expect(await blockContent('Available Tools')).toContain('- bash: Execute commands')
  expect(await blockContent('Available Tools')).not.toContain('<tools>')
  expect(await blockContent('Append Instructions')).toContain('Keep evidence concise.')
  expect(await blockContent('Working Directory')).toContain('/work/demo')
  expect(await blockContent('Working Directory')).not.toContain('Current working directory:')
  expect(await blockContent('Base Template')).not.toContain('</')
  expect(await blockContent('Skills')).not.toContain('<skills>')
  // This demo session configures no MCP servers, so the modelled section is empty
  // rather than missing: the panel always shows the full prompt model.
  expect(await blockContent('MCP Servers')).toBe('None')

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

  // Adding the context note must not push the pre-existing right-aligned counters
  // toward the middle of their bars.
  const barAlignment = await page.evaluate(() => {
    const near = (el: Element, container: Element, tolerance: number) => {
      const box = el.getBoundingClientRect()
      const parent = container.getBoundingClientRect()
      return parent.right - box.right <= tolerance
    }
    const header = document.querySelector('.turn-group > header:has(.turn-context-note)')
    const bar = document.querySelector('.branch-bar')!
    const barChildren = [...bar.children] as HTMLElement[]
    const summary = bar.querySelector('.context-summary')!
    const count = barChildren.find((el) => el.classList.contains('context-summary') === false && el.tagName === 'SPAN')!
    return {
      headerNoteRightAligned: header ? near(header.lastElementChild!, header, 20) : false,
      headerCountBeforeNote: header
        ? header.children[1].getBoundingClientRect().right <= header.lastElementChild!.getBoundingClientRect().left
        : false,
      summaryRightAligned: near(summary, bar, 20),
      countBeforeSummary: count.getBoundingClientRect().right <= summary.getBoundingClientRect().left,
    }
  })
  expect(barAlignment.headerNoteRightAligned).toBe(true)
  expect(barAlignment.headerCountBeforeNote).toBe(true)
  expect(barAlignment.summaryRightAligned).toBe(true)
  expect(barAlignment.countBeforeSummary).toBe(true)

  // Labels explain themselves on hover; they are not controls.
  await expect(page.locator('.event-context-mark').first()).toHaveCSS('cursor', 'help')

  // Timeline rows are options in the virtual listbox, with concise accessible
  // names. The subagent opener is the only native action inside a row.
  const rowA11y = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.event-row')] as HTMLElement[]
    return {
      allRoleOption: rows.every((row) => row.getAttribute('role') === 'option'),
      anyNativeButtonRow: rows.some((row) => row.tagName === 'BUTTON'),
      nestedActionButtons: rows.reduce((total, row) => total + row.querySelectorAll('button').length, 0),
      longestName: Math.max(...rows.map((row) => (row.getAttribute('aria-label') ?? '').length)),
      namesWithTitle: rows.every((row) => {
        const label = row.getAttribute('aria-label') ?? ''
        const title = row.querySelector('.event-title-line strong')?.textContent ?? ''
        return title.length === 0 || label.includes(title)
      }),
    }
  })
  expect(rowA11y.allRoleOption).toBe(true)
  expect(rowA11y.anyNativeButtonRow).toBe(false)
  expect(rowA11y.nestedActionButtons).toBe(1)
  expect(rowA11y.longestName).toBeLessThan(100)
  expect(rowA11y.namesWithTitle).toBe(true)

  // Keyboard: focus the virtual listbox, move its active option, then select it.
  await page.locator('#branch-select').focus()
  const timeline = page.locator('.timeline-scroll')
  await timeline.focus()
  await expect(timeline).toHaveAttribute('aria-activedescendant', /^event-row-/)
  const initialActiveRow = await timeline.getAttribute('aria-activedescendant')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => timeline.getAttribute('aria-activedescendant')).not.toBe(initialActiveRow)
  await expect(page.locator('.event-row.is-focused')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.locator('.event-row.is-selected')).toHaveCount(1)
  // Restore the selection the following assertions depend on.
  await testCall.click()
  await expect(page.locator('.event-context-target').first()).toHaveCSS('cursor', 'help')

  await expect(page.locator('.content-view .content-header-tokens')).toContainText('chars')
  await expect(page.locator('.content-view .content-header-tokens')).not.toContainText('tokens')
  await expect(page.locator('.content-view').getByRole('button', { name: 'Copy' })).toHaveText('Copy')

  await page.getByRole('tab', { name: 'Raw' }).click()
  await expect(page.locator('.raw-view .content-body-wrap.event--tool-call')).toBeVisible()
  await expect(page.locator('.content-view pre')).toContainText('"name": "bash"')
  await expect(page.locator('.raw-view .content-header-tokens')).toContainText('ID:')
  await expect(page.locator('.raw-view').getByRole('button', { name: 'Copy' })).toHaveText('Copy')
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

  // A subagent reference whose artifacts are gone must not wipe the timeline: the
  // jump reports itself in a dismissible strip and the session stays on screen.
  const subagentTag = page.locator('.event-subagent-tag')
  await expect(subagentTag).toHaveCount(1)
  const rowsBeforeFailedJump = await page.locator('.event-row').count()
  await subagentTag.click()
  const actionError = page.locator('.action-error-strip')
  await expect(actionError).toBeVisible()
  await expect(actionError).toContainText('Failed to load subagent session')
  await expect(page.locator('.event-row')).toHaveCount(rowsBeforeFailedJump)
  await expect(page.locator('.load-state.is-error')).toHaveCount(0)
  await actionError.locator('button').click()
  await expect(actionError).toHaveCount(0)
  await expect(page.locator('.event-row')).toHaveCount(rowsBeforeFailedJump)

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

  // The failed subagent jump probes its candidate files and is expected to 404.
  const expectedProbes = browserErrors.filter((entry) => /404 \(Not Found\) @ http:\/\/[^ ]+\/api\/sessions\//.test(entry))
  expect(expectedProbes.length, 'the failed subagent jump must have probed the API').toBeGreaterThan(0)
  expect(browserErrors.filter((entry) => !expectedProbes.includes(entry))).toEqual([])
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
  await expect(page.locator('.content-view').getByRole('button', { name: '复制' })).toHaveText('复制')

  // Verify persistence in localStorage
  const savedLocale = await page.evaluate(() => localStorage.getItem('pi_session_viewer_locale'))
  expect(savedLocale).toBe('zh-CN')

  // Reload page and confirm persisted preference remains Chinese
  await page.reload()
  await expect(page.locator('.warning-strip')).toContainText('1 条解析警告')
  await expect(page.locator('.filter-select-all')).toHaveText('全不选')
  await expect(page.locator('.content-view').getByRole('button', { name: '复制' })).toHaveText('复制')

  // Toggle back to English
  await page.getByRole('button', { name: 'EN / 中' }).click()
  await expect(page.locator('.warning-strip')).toContainText('1 parse warning')
  await expect(page.locator('.filter-select-all')).toHaveText('Clear')
  const backLocale = await page.evaluate(() => localStorage.getItem('pi_session_viewer_locale'))
  expect(backLocale).toBe('en')
})
