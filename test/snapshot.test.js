import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore, transaction } from '../online/store.js'
import { OnlineGame } from '../online/game.js'

test('human frames project a fresh snapshot, persist at one second, observe inputs and commit final results', async () => {
  let now = Date.now(), commits = 0
  const store = new MemoryStore(() => now), rawGet = store.get.bind(store), commit = store.commit.bind(store)
  store.snapshot = async () => { store.snapshotKeys = new Set(store.data.keys()); store.snap = new Map(await Promise.all([...store.snapshotKeys].map(async k => [k, await rawGet(k)]))) }
  store.get = async key => store.snap?.has(key) ? store.snap.get(key) : rawGet(key)
  store.commit = async entries => { commits++; const ok = await commit(entries); store.snap = null; store.snapshotKeys = null; return ok }
  const game = new OnlineGame(store, { now: () => now })
  const s = await game.request('POST', '/session', undefined, { name: 'snapshot' }), q = new URLSearchParams({ token: s.humanToken })
  await game.request('POST', '/play', q, { vs: 'easy', minutes: 3, planning: 10, withAgent: false })
  await game.request('GET', '/state', q)
  now += 10100
  const first = await game.request('GET', '/state', q), key = `match:${first.matchId}`
  const checkpoint = JSON.parse(await rawGet(key)).s.tick, before = commits
  now += 100
  const projected = await game.request('GET', '/state', q)
  assert.ok(projected.view.tick > checkpoint)
  assert.equal(commits, before, 'Subsecond fresh snapshot does not compete for checkpoint writes')
  assert.equal(JSON.parse(await rawGet(key)).s.tick, checkpoint)
  await game.request('POST', '/input', q, { gambits: [{ if: 'always', then: 'hold' }] })
  const observed = await game.request('GET', '/state', q)
  assert.equal(observed.view.gambits[0].then, 'hold')
  now += 1100
  const persisted = await game.request('GET', '/state', q)
  assert.equal(JSON.parse(await rawGet(key)).s.tick, persisted.view.tick)
  now += 200000
  const final = await game.request('GET', '/state', q)
  assert.ok(final.view.ended && final.report)
  assert.ok(JSON.parse(await rawGet(key)).report)
})

test('read-only optimization is refused when a read is outside the consistent snapshot', async () => {
  const store = new MemoryStore(); let commits = 0
  store.snapshotKeys = new Set(['a']); const commit = store.commit.bind(store)
  store.commit = entries => { commits++; return commit(entries) }
  await transaction(store, async tx => { await tx.get('a'); await tx.get('b'); tx.readOnly() })
  assert.equal(commits, 1)
})
