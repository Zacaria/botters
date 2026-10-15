import { defineConfig } from '@playwright/test'
const remote = process.env.BOTTERS_SERVER
const extraHTTPHeaders = remote && new URL(remote).hostname.endsWith('.vercel.app') && process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}
export default defineConfig({
  testDir: './e2e', outputDir: remote ? '.cache/test-results-remote' : 'test-results', timeout: remote ? 300000 : 90000, workers: 1,
  use: { baseURL: remote || 'http://127.0.0.1:8788', extraHTTPHeaders, browserName: 'chromium', launchOptions: { executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] }, viewport: { width: 1440, height: 900 }, trace: remote ? 'off' : 'retain-on-failure' },
  webServer: remote ? undefined : { command: 'BOTTERS_TEST_SPEED=10 node scripts/online-dev.js', url: 'http://127.0.0.1:8788', reuseExistingServer: false },
})
