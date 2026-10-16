import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { globalSetup: './integration/setup.js', include: ['integration/*.test.js'], fileParallelism: false, testTimeout: 30000, server: { deps: { inline: ['@convex-dev/better-auth', 'convex-test'] } } } })
