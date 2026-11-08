import { defineConfig } from '@playwright/test'
process.env.BOTTERS_TEST_REAL_ENTRIES = '1'
export default defineConfig({
  testDir: './e2e', testMatch: 'auth.spec.js', outputDir: '.cache/postgres-browser-results', timeout: 300000, workers: 1,
  use: { baseURL: 'https://127.0.0.1:8789', ignoreHTTPSErrors: true, browserName: 'chromium', launchOptions: { executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] }, viewport: { width: 1440, height: 900 }, trace: 'off' },
  webServer: { command: 'node scripts/postgres-browser-fixture.js', url: 'https://127.0.0.1:8789', ignoreHTTPSErrors: true, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 } },
})
