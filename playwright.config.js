import { defineConfig } from '@playwright/test'
const remote = process.env.BOTTERS_SERVER
const resolverArgs = process.env.BOTTERS_VERIFY_IP ? [`--host-resolver-rules=MAP play.botters.havesomecode.io ${process.env.BOTTERS_VERIFY_IP}`] : []
export default defineConfig({
  testDir: './e2e', testIgnore: 'auth.spec.js', outputDir: remote ? '.cache/test-results-remote' : 'test-results', timeout: remote ? 300000 : 90000, workers: 1,
  use: { baseURL: remote || 'http://127.0.0.1:8788', browserName: 'chromium', launchOptions: { executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage', ...resolverArgs] }, viewport: { width: 1440, height: 900 }, trace: remote ? 'off' : 'retain-on-failure' },
  webServer: remote ? undefined : { command: 'npm run build && BOTTERS_TEST_SPEED=10 node scripts/online-dev.js', url: 'http://127.0.0.1:8788', reuseExistingServer: false },
})
