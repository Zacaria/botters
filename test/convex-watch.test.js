import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watch } from '../convex/store.js'
import { ConvexStore } from '../online/store.js'

test('internal watch follows one capability atomically and exposes its earliest document expiry', async t => {
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  const key = 'botters:watch-test:token:' + 'a'.repeat(64), prefix = 'botters:watch-test:'
  const rows = new Map([
    [key, { value: JSON.stringify({ id: 'player', role: 'human' }), expiresAt: 2000 }],
    [prefix + 'session:player', { value: JSON.stringify({ match: 'game' }), expiresAt: 3000 }],
    [prefix + 'match:game', { value: '{"id":"game"}', expiresAt: 1500 }],
  ])
  const ctx = { db: { query: () => ({ withIndex: (_, f) => { let key; f({ eq: (_, value) => { key = value } }); return { unique: async () => rows.get(key) || null } } }) } }
  const first = await watch._handler(ctx, { key })
  assert.equal(first.expiresAt, 1500)
  assert.deepEqual(first.keys, [...rows.keys()])
  assert.equal(first.values.length, 3)
  now = 2000
  const expired = await watch._handler(ctx, { key })
  assert.deepEqual(expired.keys, [key]); assert.deepEqual(expired.values, [null])
})

test('subscribed snapshots are invocation-local, expire closed and stop on connection failure', async () => {
  const root = new ConvexStore({}), store = root.scoped(), other = root.scoped()
  let reads = 0
  store.call = async () => { reads++; return { keys: ['botters:preview:token:x'], values: [null] } }
  store.watchSnapshot = { keys: ['botters:preview:token:x'], values: ['{"id":"x"}'], expiresAt: Date.now() + 10000 }
  store.watchValidatedAt = Date.now()
  await store.snapshot('token:x')
  assert.equal(reads, 0); assert.equal(store.cache.get('token:x'), '{"id":"x"}')
  assert.equal(other.watchSnapshot, undefined)
  store.watchSnapshot.expiresAt = 1
  await store.snapshot('token:x')
  assert.equal(reads, 1); assert.equal(store.cache.get('token:x'), null)
  store.watchValidatedAt = Date.now() - 5001
  await store.snapshot('token:x')
  assert.equal(reads, 2, 'Half-open connections require fresh authority within five seconds')
  store.watchConnected = () => false
  await assert.rejects(store.snapshot('token:x'), e => e.status === 503)
  assert.equal(reads, 2, 'A disconnected subscription must not serve cached authority')
})
