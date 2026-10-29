import { expect, test } from '@playwright/test'

const projectCwds = [
  '/work/project-a',
  '/work/project-b',
  '/work/project-c',
  '/work/project-d',
]

function syntheticSessions() {
  return Array.from({ length: 400 }, (_, offset) => {
    const number = offset + 1
    const cwd = projectCwds[Math.floor(offset / 100)]
    const token = `synthetic-${String(number).padStart(3, '0')}`
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, number)).toISOString()

    return {
      token,
      id: token,
      title: `Synthetic session ${number}`,
      cwd,
      timestamp,
      modifiedAt: timestamp,
      relativePath: `${cwd.slice('/work/'.length)}/${token}.jsonl`,
    }
  })
}

function sessionContent(number: number, cwd: string) {
  const token = `synthetic-${String(number).padStart(3, '0')}`
  const timestamp = '2026-01-01T00:00:00.000Z'
  return [
    JSON.stringify({ type: 'session', version: 3, id: token, timestamp, cwd }),
    JSON.stringify({ type: 'session_info', id: 'info', parentId: null, timestamp, name: `Synthetic session ${number}` }),
    JSON.stringify({
      type: 'message',
      id: 'user',
      parentId: 'info',
      timestamp,
      message: { role: 'user', timestamp: Date.parse(timestamp), content: `Open synthetic session ${number}` },
    }),
  ].join('\n')
}

test('virtualizes the 400-session catalog across scope, filtering, selection, and mobile navigation', async ({ page }) => {
  const sessions = syntheticSessions()
  const projects = projectCwds.map((cwd) => {
    const projectSessions = sessions.filter((session) => session.cwd === cwd)
    return {
      cwd,
      name: cwd.split('/').at(-1) ?? cwd,
      count: projectSessions.length,
      latestModifiedAt: projectSessions.at(-1)?.modifiedAt ?? '',
    }
  })
  const sessionByToken = new Map(sessions.map((session) => [session.token, session]))

  await page.route('**/api/sessions', async (route) => {
    await route.fulfill({
      json: {
        root: '/synthetic/sessions',
        currentCwd: projectCwds[0],
        projects,
        sessions,
        warnings: [],
      },
    })
  })
  await page.route('**/api/sessions/*', async (route) => {
    const token = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '')
    const session = sessionByToken.get(token)
    if (!session) {
      await route.fulfill({ status: 404, json: { error: 'Synthetic session not found' } })
      return
    }
    const number = Number(token.slice('synthetic-'.length))
    await route.fulfill({
      json: {
        token,
        relativePath: session.relativePath,
        modifiedAt: session.modifiedAt,
        content: sessionContent(number, session.cwd),
      },
    })
  })

  await page.goto('/#token=dev-token')

  const sessionList = page.locator('.session-list')
  await expect(page.getByRole('tab', { name: 'Current Project (100)' })).toHaveAttribute('aria-selected', 'true')
  await expect(sessionList.locator('.session-item').first()).toContainText('Synthetic session 1')
  await expect(page.locator('.header-session strong')).toHaveText('Synthetic session 1')
  expect(await sessionList.locator('.session-item').count()).toBeLessThan(40)

  await page.getByRole('tab', { name: 'All (400)' }).click()
  const projectFilter = page.getByRole('combobox', { name: 'Filter by project' })
  await projectFilter.selectOption(projectCwds[1])
  await expect(sessionList.locator('.session-item').first()).toContainText('Synthetic session 101')
  expect(await sessionList.locator('.session-item').count()).toBeLessThan(40)

  await page.getByRole('tab', { name: 'Current Project (100)' }).click()
  await expect(page.getByRole('tab', { name: 'Current Project (100)' })).toHaveAttribute('aria-selected', 'true')
  await expect(sessionList.locator('.session-item').first()).toContainText('Synthetic session 1')

  await page.getByRole('tab', { name: 'All (400)' }).click()
  const allProjectsOption = page.getByRole('option', { name: 'All projects (400)' })
  await expect(allProjectsOption).toBeAttached()
  await projectFilter.selectOption('')
  await expect(sessionList.locator('.session-item').first()).toContainText('Synthetic session 1')
  await sessionList.evaluate((element) => { element.scrollTop = element.scrollHeight })

  const lastSession = sessionList.locator('.session-item').filter({ hasText: 'Synthetic session 400' })
  await expect(lastSession).toBeVisible()
  expect(await sessionList.locator('.session-item').count()).toBeLessThan(40)
  await lastSession.click()
  await expect(lastSession).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.header-session strong')).toHaveText('Synthetic session 400')

  await sessionList.evaluate((element) => { element.scrollTop = 0 })
  await sessionList.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(lastSession).toHaveAttribute('aria-current', 'page')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open session list', exact: true }).click()
  await expect(page.locator('.sidebar-layer')).toHaveClass(/is-open/)
  await lastSession.click()
  await expect(page.locator('.sidebar-layer')).not.toHaveClass(/is-open/)
})
