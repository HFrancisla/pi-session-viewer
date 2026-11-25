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
  await page.locator('.event-row.event--system-prompt').first().click()

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

  await page.getByRole('tab', { name: 'Diff' }).click()
  for (const kind of ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'tool-definitions']) {
    await page.locator(`.event-row.event--${kind}`).first().click()
    await expect(page.locator('.inspector [role="tab"]')).toHaveText(['Overview', 'Content', 'Raw'])
    await expect(page.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true')
  }
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

    await page.locator('.event-row.event--system-prompt').first().click()
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
  await page.locator('.event-row.event--system-prompt').first().click()
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
    document.execCommand = () => false
  })
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Current Project (1)' })).toHaveText('Current (1)')
  await expect(page.getByRole('button', { name: 'Select all' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Event filter' }).getByRole('checkbox')).toHaveCount(8)

  await page.locator('.header-session .header-path-copy').click()
  await expect(page.locator('.copy-status-toast')).toHaveText('Copy failed')
  await page.locator('.event-row').first().click()
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveAttribute('data-copy-status', 'error')
  await expect(page.locator('.copy-status-toast')).toHaveCount(1)
  await expect(page.locator('.header-path-copy')).toHaveAttribute('data-copy-status', 'idle')
  await page.locator('.event-row.event--system-prompt').first().click()
  await page.getByRole('tab', { name: 'Diff' }).click()
  await expect(page.locator('.copy-status-toast')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Previous snapshot' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Vanilla \(/ })).toHaveAttribute('aria-pressed', 'true')
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
  await expect(page.locator('.load-state-actions')).toContainText('open a local Pi session file')
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

test('uses compact session facts, quieter metadata, and singular catalog copy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  await expect(page.locator('.sidebar-heading p')).toHaveText('1 in project, 1 total')
  await expect(page.locator('.session-summary > div').first().locator('strong')).toHaveCSS('font-size', '12px')
  await expect(page.locator('.session-summary > div').last().locator('strong')).toHaveCSS('font-size', '12px')
  await expect(page.locator('.event-char-count').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await page.setViewportSize({ width: 1024, height: 740 })
  const metrics = await page.evaluate(() => ({ viewport: innerWidth, pageWidth: document.documentElement.scrollWidth }))
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewport)
})


test('offline native state uses native records and distinguishes empty forced observation', async ({ page }) => {
  const timestamp = '2026-01-01T10:00:00.000Z'
  const lines = [
    { type: 'session', version: 3, id: 'offline-native', timestamp, cwd: '/work/demo' },
    { type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', content: 'Hello' } },
    { type: 'message', id: 'system', parentId: 'user', timestamp, message: { role: 'system', timestamp: 1, content: '', sections: { custom_section: 'exact text' } } },
    { type: 'message', id: 'assistant', parentId: 'system', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] } },
    { type: 'custom', id: 'obs', parentId: 'assistant', timestamp, customType: 'pi-session-viewer.observation', data: { schemaVersion: 1, piVersion: '1.6.0', anchorEntryId: 'system', assistantEntryId: 'assistant', forcedPrompt: '' } },
  ].map(entry => JSON.stringify(entry)).join('\n')
  const apiRequests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/')) apiRequests.push(request.url()) })
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({ name: 'native.jsonl', mimeType: 'application/json', buffer: Buffer.from(lines) })
  await expect(page.locator('.event-row.event--system-prompt')).toHaveCount(1)
  const inspector = page.locator('.inspector')
  await page.locator('.event-row.event--user').click()
  await expect(inspector.locator('[role="tab"]')).toHaveText(['Overview', 'Content', 'Raw'])
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(inspector.locator('.event-facts dt').filter({hasText: /^System prompt$/})).toHaveCount(0)
  await expect(inspector.locator('.overview-composition, .state-section, .prompt-composition')).toHaveCount(0)
  await page.locator('.event-row.event--system-prompt').click()
  await page.getByRole('tab', { name: 'Content' }).click()
  await expect(inspector.locator('.content-body-wrap pre')).toHaveText('exact text')
  await expect(inspector.locator('.content-header-tokens')).toHaveText('10 chars')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.copiedPrompt = text },
    } })
  })
  await inspector.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-copied-prompt', 'exact text')
  await page.getByRole('tab', { name: 'Composition' }).click()
  await expect(inspector.locator('.inspector-section-title')).toContainText('custom_section')
  await expect(inspector.locator('.inspector-section pre')).toContainText('exact text')
  await page.locator('.event-row.event--assistant').click()
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(inspector.locator('.overview-composition, .state-section')).toHaveCount(0)
  await expect(inspector.locator('.event-facts dt').filter({hasText: /^System prompt$/})).toHaveCount(0)
  await page.getByRole('tab', { name: 'Composition' }).click()
  const forced = inspector.locator('.inspector-section').filter({ hasText: 'Observed forced prompt' })
  await expect(forced.locator('pre')).toContainText('Explicitly observed empty string')
  await expect(inspector).not.toContainText('Supplemental observation')
  expect(apiRequests).toEqual([])
})

test('原生分区恢复原有组成和工具定义样式，差异逐行展示', async ({ page }) => {
  const timestamp = '2026-01-01T10:00:00.000Z'
  const tools = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'codemode', 'web_enable', 'subagent', 'contact_supervisor', 'bg_wait', 'skill', 'ask_user_question', 'subagent_supervisor']
    .map(name => ({ name, description: 'A native tool declaration', parameters: { type: 'object' } }))
  const lines = [
    { type: 'session', version: 3, id: 'inspector-layout', timestamp, cwd: '/work/demo' },
    { type: 'message', id: 'native-first', parentId: null, timestamp, message: { role: 'system', timestamp: 1, content: '', sections: { preamble: 'Base', tools: 'Tools', rules: 'Rules before', docs: 'Docs', project_context: 'Project', skills: 'Skills', cwd: '/work/demo', advertised_subagents: 'Agents', mcp_servers: 'MCP' }, toolsAdded: tools } },
    { type: 'message', id: 'native-next', parentId: 'native-first', timestamp, message: { role: 'system', timestamp: 2, content: '', sections: { rules: 'Rules after', mcp_servers: null, custom_section: 'Exact custom text' } } },
  ].map(entry => JSON.stringify(entry)).join('\n')
  await page.addInitScript(() => localStorage.setItem('pi_session_viewer_locale', 'zh-CN'))
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({ name: 'inspector-layout.jsonl', mimeType: 'application/json', buffer: Buffer.from(lines) })
  await page.locator('.event-row[data-event-id="native-first:system-context"]').click()
  await page.getByRole('tab', { name: '组成' }).click()
  const inspector = page.locator('.inspector')
  const panel = inspector.locator('.prompt-composition')
  await expect(panel.locator('.inspector-section')).toHaveCount(9)
  await expect(panel.locator('.inspector-section-title').first()).toContainText('基础模板')
  await expect(panel.locator('.inspector-section-header').first()).toHaveCSS('font-size', '12px')
  await expect(panel.locator('.inspector-section-meta').first()).toHaveText('4 字符')
  await expect(panel).not.toContainText('状态记录')
  await expect(panel).not.toContainText('补充观测')
  await expect(panel.locator('.state-section, .tool-definitions-view')).toHaveCount(0)
  for (const width of [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await panel.locator('.inspector-section-header').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1))).toBe(true)
  }

  await page.getByRole('tab', { name: '差异' }).click()
  await expect(page.getByRole('button', { name: '上一份有效提示词' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Vanilla \(/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.diff-row--removed').filter({hasText:'You are a coding assistant running inside pi'})).toBeVisible()
  await expect(page.getByRole('button', { name: '复制 Diff' })).toBeEnabled()

  await page.locator('.event-row.event--tool-definitions').click()
  await expect(inspector.locator('[role="tab"]')).toHaveText(['概览', '内容', '原始数据'])
  await expect(inspector.locator('.tool-definitions-view .inspector-section')).toHaveCount(15)
  await expect(inspector.locator('.tool-source-badge--unknown')).toHaveCount(15)
  await expect(inspector).not.toContainText('个注册来源未记录')
  await expect(inspector.locator('.tool-definitions-view pre').first()).toContainText('A native tool declaration')
  await page.getByRole('tab', { name: '概览' }).click()
  await expect(inspector).toContainText('15 个 API 工具')

  await page.locator('.event-row[data-event-id="native-next:system-context"]').click()
  await page.getByRole('tab', { name: '差异' }).click()
  await expect(page.locator('.prompt-diff-baseline-pill')).toHaveCount(2)
  await expect(page.locator('.prompt-diff-baseline-pill.is-active')).toHaveAttribute('title', 'native-first')
  await expect(page.locator('.prompt-diff-badges')).toContainText('+3')
  await expect(page.locator('.prompt-diff-badges')).toContainText('-3')
  await expect(page.locator('.diff-table .diff-row--removed')).toHaveCount(3)
  await expect(page.locator('.diff-table .diff-row--added')).toHaveCount(3)
  await expect(page.locator('.diff-row--removed').filter({hasText:'Rules before'})).toBeVisible()
  await expect(page.locator('.diff-row--added').filter({hasText:'Rules after'})).toBeVisible()
  await expect(page.locator('.diff-row--unchanged').filter({hasText:'Base'}).first()).toBeVisible()
  await expect(page.locator('.state-diff-list')).toHaveCount(0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.copiedDiff = text },
    } })
  })
  await page.getByRole('button', { name: '复制 Diff' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-copied-diff', /- Rules before/)
  await expect(page.locator('html')).toHaveAttribute('data-copied-diff', /\+ Rules after/)
  await page.getByRole('button', { name: /^Vanilla \(/ }).click()
  await expect(page.locator('.diff-row--added').filter({hasText:'Exact custom text'})).toBeVisible()
  await page.getByRole('button', { name: '上一份有效提示词' }).click()
  await expect(page.locator('.prompt-diff-badges')).toContainText('+3')
  await expect(page.locator('.prompt-diff-badges')).toContainText('-3')
})

test('工具定义显示首次关联请求真实观测的来源', async ({ page }) => {
  const timestamp = '2026-01-01T10:00:00.000Z'
  const tools = ['read', 'write', 'web_search'].map(name => ({name,description:name,parameters:{}}))
  const rows = [
    {type:'session',version:3,id:'source-view',timestamp,cwd:'/work/demo'},
    {type:'message',id:'s',parentId:null,timestamp,message:{role:'system',timestamp:1,content:'',toolsAdded:tools}},
    {type:'message',id:'u',parentId:'s',timestamp,message:{role:'user',content:'hello'}},
    {type:'message',id:'a',parentId:'u',timestamp,message:{role:'assistant',stopReason:'toolUse',content:[{type:'text',text:'ok'},{type:'toolCall',id:'call-write',name:'write',arguments:{}}]}},
    {type:'custom',id:'o',parentId:'a',timestamp,customType:'pi-session-viewer.observation',data:{
      schemaVersion:1,piVersion:'1.6.0',anchorEntryId:'u',assistantEntryId:'a',
      toolSources:[
        {name:'read',sourceInfo:{path:'builtin:read',source:'builtin'}},
        {name:'write',sourceInfo:{path:'/work/node_modules/pi-cc-extensions/dist/index.js',source:'npm:pi-cc-extensions'}},
        {name:'web_search',sourceInfo:{path:'/work/node_modules/pi-web-access/dist/index.js',source:'npm:pi-web-access'}},
      ],
    }},
    {type:'message',id:'r',parentId:'o',timestamp,message:{role:'toolResult',toolCallId:'call-write',toolName:'write',content:[{type:'text',text:'ok'}],isError:false}},
  ]
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({name:'source-view.jsonl',mimeType:'application/json',buffer:Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n'))})
  await page.locator('.event-row.event--tool-definitions').click()
  const list = page.locator('.tool-definitions-view')
  await expect(list.locator('.tool-source-badge--builtin')).toHaveCount(1)
  await expect(list.locator('.tool-source-badge--extension')).toHaveCount(2)
  await expect(list.locator('.tool-source-badge--unknown')).toHaveCount(0)
  await expect(list).toContainText('pi-cc-extensions')
  await expect(list).toContainText('pi-web-access')
  await page.getByRole('tab',{name:'Raw'}).click()
  await expect(page.locator('.inspector pre')).not.toContainText('sourceInfo')
  const inspector = page.locator('.inspector')
  for (const kind of ['user', 'assistant', 'tool-call', 'tool-result', 'system-prompt', 'tool-definitions']) {
    await page.locator(`.event-row.event--${kind}`).first().click()
    await page.getByRole('tab', {name:'Overview'}).click()
    await expect(inspector.locator('.event-facts dt').filter({hasText:/^(System prompt|Tool definitions|Tool definition|Observed tool sources)$/})).toHaveCount(0)
    if (kind === 'tool-call' || kind === 'tool-result') {
      await expect(inspector.locator('.tool-name-fact .tool-source-badge')).toHaveText('pi-cc-extensions')
    }
  }
})

test('copies through selection when the Clipboard API is unavailable or rejects', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    document.execCommand = (command) => {
      const active = document.activeElement
      if (command !== 'copy' || !(active instanceof HTMLTextAreaElement)) return false
      document.body.dataset.copied = active.value
      return true
    }
  })
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  const copy = page.locator('.header-path-copy')
  await copy.click()
  await expect(copy).toHaveAttribute('data-copy-status', 'success')
  await expect(page.locator('body')).toHaveAttribute('data-copied', /demo\.jsonl$/)
  await expect(copy).toBeFocused()
  await expect(page.locator('textarea')).toHaveCount(0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('denied') } },
    })
    delete document.body.dataset.copied
  })
  await copy.click()
  await expect(copy).toHaveAttribute('data-copy-status', 'success')
  await expect(page.locator('body')).toHaveAttribute('data-copied', /demo\.jsonl$/)
})
