import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PostgresLiveDurable } from '../online/postgres-live-durable.js'

const waitFor = async predicate => {
  const end = Date.now() + 3000
  while (!predicate() && Date.now() < end) await new Promise(r => setTimeout(r, 10))
  assert.ok(predicate(), 'authority did not update within deadline')
}

test('authority refreshes revocation and fails closed if its source stalls', async () => {
  let snapshot = { token: 'grant', session: 'owner', expiresAt: Date.now() + 60000 }
  const store = { authorize: async () => snapshot }
  const remote = new PostgresLiveDurable(store, { intervalMs: 25, leaseMs: 150 })
  let current
  const entry = await remote.authority('token:key', async value => { current = value })
  try {
    assert.equal(current.token, 'grant')
    assert.ok(entry.connected())
    snapshot = { token: null, session: null, expiresAt: Date.now() }
    await waitFor(() => current.token === null)
    snapshot = { token: 'grant2', session: 'owner', expiresAt: Date.now() + 60000 }
    await waitFor(() => current.token === 'grant2')
    store.authorize = () => new Promise(() => {})
    await waitFor(() => !entry.connected())
  } finally { await entry.close() }
})

test('authority marks a failed refresh unavailable', async () => {
  let reject = false
  const remote = new PostgresLiveDurable({ authorize: async () => { if (reject) throw new Error('offline'); return { token: 'grant', session: 'owner', expiresAt: Date.now() + 60000 } } }, { intervalMs: 25, leaseMs: 150 })
  const entry = await remote.authority('token:key', async () => {})
  reject = true
  try { await waitFor(() => !!entry.error); assert.equal(entry.connected(), false) } finally { await entry.close() }
})
