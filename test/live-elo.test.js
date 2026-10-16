import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { LiveStore } from '../online/live-store.js'
import { LiveRuntime } from '../online/live-runtime.js'
import { MemoryStore } from '../online/store.js'
const q = token => new URLSearchParams({ token })
test('durable leaderboard guards and concurrent Elo changes do not duplicate a result', async t => {
  let now = Date.now(), conflict = false, commits = 0
  const durable = new MemoryStore(() => now)
  const participant = 'elo:' + createHash('sha256').update(JSON.stringify(['elo-live', 'no agent'])).digest('hex')
  durable.data.set('elo:' + 'f'.repeat(64), { value: JSON.stringify({ name: 'external', setup: 'agent', rating: 3000, games: 1 }), expires: 0 })
  const store = new LiveStore({
    get: k => durable.get(k),
    read: keys => {
      if (conflict && keys.includes(participant)) {
        conflict = false
        durable.data.set(participant, { value: JSON.stringify({ name: 'elo-live', setup: 'no agent', rating: 1500, games: 4 }), expires: 0 })
      }
      return Promise.resolve(keys.map(k => durable.raw(k)))
    },
    commit: entries => { commits++; return durable.commit(entries) },
  }, { now: () => now })
  const runtime = new LiveRuntime(store, { now: () => now }); t.after(() => runtime.close())
  const a = await runtime.request('POST', '/session', undefined, { name: 'elo-live' })
  assert.equal((await runtime.request('GET', '/lobby', q(a.humanToken))).leaderboard[0].name, 'external')
  await runtime.request('POST', '/profile', q(a.humanToken), { doctrine: 'Saved across server restarts.' })
  const owner = JSON.parse(store.raw('token:' + createHash('sha256').update(a.humanToken).digest('hex'))).id
  assert.equal(JSON.parse(durable.raw(`session:${owner}`)).doctrine, 'Saved across server restarts.')
  await runtime.request('POST', '/play', q(a.humanToken), { minutes: 3, planning: 10, withAgent: false })
  now += 200000; conflict = true
  const before = commits
  const f = await runtime.request('GET', '/state', q(a.humanToken))
  assert.ok(f.report)
  assert.equal(commits, before + 1, 'One final atomic write after the conflicting read is refreshed')
  assert.equal(JSON.parse(durable.raw(participant)).games, 5)
  assert.equal((await runtime.request('GET', '/lobby', q(a.humanToken))).leaderboard[0].name, 'external')
  assert.equal(JSON.parse(durable.raw(`session:${owner}`)).history.length, 1)
})
