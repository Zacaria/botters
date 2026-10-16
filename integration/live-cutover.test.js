import { test, expect } from 'vitest'
import { convexTest } from 'convex-test'
import schema from '../convex/schema.js'
import { internal } from '../convex/_generated/api.js'
const modules = import.meta.glob('../convex/**/*.js')
test('cutover checks aggregate active legacy matches without returning player records', async () => {
  const t = convexTest(schema, modules), now = Date.now()
  await t.run(async ctx => {
    const add = (id, startsAt, ended, expiresAt, prefix = 'botters:production:') => ctx.db.insert('records', { key: `${prefix}match:${id}`, value: JSON.stringify({ startsAt, s: { endTick: 9600, ended }, players: [{ name: 'private fixture' }] }), expiresAt })
    await add('active', now, null, now + 86400000)
    await add('finished', now, { winner: 0 }, now + 86400000)
    await add('old', now - 600000, null, now + 86400000)
    await add('expired', now, null, now - 1000)
    await add('other', now, null, now + 86400000, 'botters:preview:')
  })
  const r = await t.query(internal.store.legacyActivity, { prefix: 'botters:production:', now: -1 })
  expect(r.complete).toBe(true); expect(r.activeMatches).toBe(1); expect(r.scanned).toBe(4)
  expect(r.latestActiveEndAt).toBeGreaterThan(now)
  expect(JSON.stringify(r)).not.toContain('private fixture')
})
