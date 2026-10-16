import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: 'auth.spec.js', outputDir: '.cache/auth-browser-results', timeout: 90000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:8789', browserName: 'chromium', launchOptions: { executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] }, viewport: { width: 1440, height: 900 }, trace: 'off' },
  webServer: { command: 'node scripts/auth-dev.js', url: 'http://127.0.0.1:8789', reuseExistingServer: false },
})
