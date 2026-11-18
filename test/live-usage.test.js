import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LiveStore } from '../online/live-store.js'
import { LiveRuntime } from '../online/live-runtime.js'
import { MemoryStore } from '../online/store.js'

test('finished house match records one permanent private usage boundary', async t => {
  let now = Date.now()
  const durable = new MemoryStore(() => now)
  const store = new LiveStore({ get: k => durable.get(k), read: keys => Promise.all(keys.map(k => durable.get(k))), commit: entries => durable.commit(entries) }, { now: () => now })
  const runtime = new LiveRuntime(store, { now: () => now }); t.after(() => runtime.close())
  const player = await runtime.request('POST', '/session', undefined, { name: 'Private name' })
  const q = new URLSearchParams({ token: player.humanToken })
  await runtime.request('POST', '/play', q, { minutes: 3, planning: 10, withAgent: false })
  now += 200000
  assert.ok((await runtime.request('GET', '/state', q)).report)
  await runtime.request('GET', '/state', q)
  const usage = [...durable.data].filter(([key]) => key.startsWith('usage:'))
  assert.equal(usage.length, 1)
  assert.equal(usage[0][1].expires, 0)
  assert.deepEqual(JSON.parse(usage[0][1].value), { at: now, online: false, agent: false, accounts: [] })
  assert.doesNotMatch(usage[0][1].value, /Private name|session|token/i)
})
