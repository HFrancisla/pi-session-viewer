import { defineConfig, devices } from '@playwright/test'

const testPort = process.env.PORT ?? '5190'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `PORT=${testPort} PI_SESSION_VIEWER_DEV_TOKEN=dev-token PI_CODING_AGENT_SESSION_DIR=tests/fixtures/sessions npm run dev`,
    url: `http://127.0.0.1:${testPort}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
