// Actual configured Convex backend. Isolated expiring fixtures; no inference or tokens in output.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ConvexStore, transaction } from '../online/store.js'
import { OnlineGame } from '../online/game.js'
const env = { ...process.env, BOTTERS_NAMESPACE: `integration-${randomUUID()}` }
const store = new ConvexStore(env)
if (!store.url || !store.token) throw new Error('Configure CONVEX_URL and CONVEX_DEPLOY_KEY in an ignored env file.')
const written = new Set(), commit = store.commit.bind(store)
store.commit = (entries, options) => { entries.filter(e => e.value !== '').forEach(e => written.add(e.key)); return commit(entries, options) }
const entry = (key, raw, value, ttl = 30) => ({ key, raw, value, ttl })
assert.equal(await store.commit([entry('a', null, '1'), entry('b', null, '2')]), 1)
assert.equal(await store.commit([entry('a', 'wrong', '3'), entry('b', '2', '4')]), 0)
assert.equal(await store.get('b'), '2', 'Failed CAS must not partially write')
const races = await Promise.all(Array.from({ length: 8 }, () => store.commit([entry('a', '1', 'raced')])))
assert.equal(races.filter(Boolean).length, 1, 'Only one concurrent writer wins')
assert.equal(await store.commit([entry('expiry', null, 'short', .2)]), 1)
await new Promise(r => setTimeout(r, 300))
assert.equal(await store.get('expiry'), null)
assert.equal(await store.commit([entry('expiry', null, 'replacement')]), 1, 'Expired physical row compares as missing')
await store.commit([entry('guard', null, 'unchanged', .5)])
await store.commit([entry('guard', 'unchanged', '', 100)])
await new Promise(r => setTimeout(r, 550))
assert.equal(await store.get('guard'), null, 'Read-only guard must not refresh TTL')
await store.commit([entry('cache-expiry', null, '"expired"', .2)])
const cached = new ConvexStore(env).scoped()
await cached.get('cache-expiry'); await new Promise(r => setTimeout(r, 300))
assert.equal(await transaction(cached, tx => tx.get('cache-expiry')), null, 'CAS rejects expired invocation-cache records')
const isolated = new ConvexStore({ ...env, BOTTERS_NAMESPACE: `${env.BOTTERS_NAMESPACE}-other` })
assert.equal(await isolated.get('a'), null)
const boardStore = new ConvexStore({ ...env, BOTTERS_NAMESPACE: `${env.BOTTERS_NAMESPACE}-board` })
const ratings = Array.from({ length: 14 }, (_, i) => entry(`elo:${i.toString(16).padStart(64, '0')}`, null, JSON.stringify({ name: `p${i}`, setup: 'fixture', rating: 1000 + i, games: 1 }), 0))
assert.equal(await boardStore.commit(ratings), 1)
const beforeBoard = await boardStore.get('leaderboard'), pairs = JSON.parse(beforeBoard)
assert.equal(pairs.length, 12); assert.equal(pairs[0][1].rating, 1013)
const top = ratings.at(-1), lower = JSON.stringify({ ...JSON.parse(top.value), rating: 900 })
assert.equal(await boardStore.commit([entry(top.key, top.value, lower, 0)]), 1)
assert.equal(await boardStore.commit([entry('leaderboard', beforeBoard, '', 0)]), 0, 'Indexed leaderboard participates in CAS')
assert.equal(JSON.parse(await boardStore.get('leaderboard'))[0][1].rating, 1012)
await boardStore.commit(ratings.map(e => entry(e.key, e === top ? lower : e.value, e === top ? lower : e.value, 1)))
for (const kind of ['query', 'mutation']) {
  const r = await fetch(`${store.url}/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: kind === 'query' ? 'store:get' : 'store:commit', args: kind === 'query' ? { keys: [store.prefix + 'a'], now: Date.now() } : { entries: [] }, format: 'json' }) })
  assert.ok(!r.ok || (await r.json()).status === 'error', 'Internal store must reject anonymous invocation')
}
let now = Date.now()
const game = new OnlineGame(store, { now: () => now })
const call = (s, method, path, body = {}, role = 'human') => game.request(method, path, new URLSearchParams({ token: s[`${role}Token`] }), body)
const sessions = await Promise.all(['a', 'b'].map(name => game.request('POST', '/session', undefined, { name, setup: 'convex-check' })))
await Promise.all(sessions.map(s => call(s, 'POST', '/play', { vs: 'player', minutes: 3, planning: 10 })))
const frames = await Promise.all(sessions.map(s => call(s, 'GET', '/state')))
assert.equal(frames[0].matchId, frames[1].matchId)
const inputs = await Promise.allSettled(Array.from({ length: 8 }, () => call(sessions[0], 'POST', '/input', { gambits: [{ if: 'always', then: 'hold' }] }, 'agent')))
assert.equal(inputs.filter(r => r.status === 'fulfilled').length, 5)
assert.equal(inputs.filter(r => r.reason?.status === 429).length, 3)
now += 200000
await Promise.all(sessions.map(s => call(s, 'GET', '/state')))
const lobby = await call(sessions[0], 'GET', '/lobby')
assert.equal(lobby.history.length, 1); assert.equal(lobby.leaderboard.length, 2)
const cold = new OnlineGame(new ConvexStore(env), { now: () => now })
const resumed = await cold.request('GET', '/state', new URLSearchParams({ token: sessions[0].humanToken }))
assert.ok(resumed.view.ended && resumed.report)
// Expire only this script's newly created fixtures, including normally permanent Elo.
for (const key of written) {
  const raw = await store.get(key)
  if (raw !== null) await store.commit([entry(key, raw, raw, 1)])
}
console.log('PASS: actual Convex multi-key CAS, no partial writes, concurrent winner, TTL/guards, namespace isolation, anonymous denial, concurrent matchmaking, shared 5/s limit, exactly-once Elo/history, new-instance resume.')
