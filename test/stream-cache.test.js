import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { view, replay } from '../sim.js'
import { createHandler } from '../online/http.js'
import { OnlineGame } from '../online/game.js'
import { ConvexStore, MemoryStore } from '../online/store.js'

function fixture() {
  let now = Date.now(), calls = 0
  const memory = new MemoryStore(() => now), store = new ConvexStore({ BOTTERS_NAMESPACE: 'test' })
  store.call = async (kind, path, args) => {
    calls++
    if (kind === 'mutation') return memory.commit(args.entries.map(e => ({ ...e, key: e.key.slice(store.prefix.length) })))
    const keys = args.keys.map(k => k.slice(store.prefix.length)), values = keys.map(k => memory.raw(k))
    if (!args.followToken) return values
    const auth = values[0] && JSON.parse(values[0])
    if (auth) {
      keys.push(`session:${auth.id}`); values.push(memory.raw(keys.at(-1)))
      const session = values.at(-1) && JSON.parse(values.at(-1))
      if (session?.match) { keys.push(`match:${session.match}`); values.push(memory.raw(keys.at(-1))) }
    }
    return { keys: keys.map(k => store.prefix + k), values }
  }
  const game = () => new OnlineGame(store.scoped(), { now: () => now })
  return { memory, store, game, now: () => now, advance: ms => { now += ms }, calls: () => calls }
}
const query = token => new URLSearchParams({ token })
async function match(f) {
  const creator = f.game(), session = await creator.request('POST', '/session', undefined, { name: 'Player', setup: 'agent' })
  const q = query(session.humanToken)
  await creator.request('POST', '/play', q, { minutes: 3, planets: 16, planning: 10, withAgent: true })
  return { session, q }
}

test('stream projects deterministic fogged frames without calls, mutation or stale authority writes', async () => {
  const f = fixture(), { q } = await match(f), game = f.game()
  await game.request('GET', '/state', q)
  const before = structuredClone([...f.memory.data]), calls = f.calls()
  f.advance(10400)
  const projected = game.projectFrame(q)
  assert.ok(projected?.view.tick > 0)
  assert.equal(projected.s, undefined); assert.equal(projected.log, undefined)
  assert.equal(f.calls(), calls)
  assert.deepEqual([...f.memory.data], before, 'Projection must never write authoritative state')
  const authoritative = await f.game().request('GET', '/state', q)
  assert.deepEqual(projected.view, authoritative.view)
  assert.deepEqual(projected.me, authoritative.me)
  assert.equal(game.projectFrame(query('x'.repeat(32))), null, 'Never reuse another token snapshot')
})

test('new input is adopted on refresh; end requires canonical finalization; expired tokens fail closed', async () => {
  const f = fixture(), { q, session } = await match(f), game = f.game()
  await game.request('GET', '/state', q)
  await f.game().request('POST', '/input', q, { gambits: [{ if: 'always', then: 'hold' }] })
  await game.request('GET', '/state', q)
  assert.equal(game.projectFrame(q).view.gambits[0].then, 'hold')
  f.advance(191000)
  assert.equal(game.projectFrame(q), null, 'Ended projection must refresh report/history/Elo through CAS')
  const final = await game.request('GET', '/state', q)
  assert.ok(final.report?.actual)
  const key = `token:${createHash('sha256').update(session.humanToken).digest('hex')}`
  const value = JSON.parse(f.memory.raw(key)); value.expires = 1
  await f.memory.commit([{ key, raw: f.memory.raw(key), value: JSON.stringify(value), ttl: 0 }])
  const expired = f.game(); await expired.store.snapshot(key)
  assert.equal(expired.projectFrame(q), null)
})

test('HTTP stream reads bounded snapshots, adopts concurrent inputs and revocation fails closed', async t => {
  const f = fixture(), { q, session } = await match(f)
  f.advance(10000)
  const clock = setInterval(() => f.advance(20), 20)
  t.after(() => clearInterval(clock))
  const server = http.createServer((req, res) => handler(req, res))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  const handler = createHandler(f.store, { origin, now: f.now, streamMs: 2300 })
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)) })
  const before = f.calls(), times = [], frames = []
  const response = await fetch(`${origin}/stream?${q}`)
  const update = setTimeout(() => f.game().request('POST', '/input', q, { gambits: [{ if: 'always', then: 'hold' }] }), 200)
  t.after(() => clearTimeout(update))
  let buffer = ''
  for await (const chunk of response.body) {
    buffer += new TextDecoder().decode(chunk)
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, end); buffer = buffer.slice(end + 2)
      if (!event.startsWith('data: ')) continue
      frames.push(JSON.parse(event.slice(6))); times.push(performance.now())
    }
  }
  assert.ok(frames.length >= 25)
  assert.ok((times.length - 1) * 1000 / (times.at(-1) - times[0]) >= 10)
  assert.equal(frames.at(-1).view.gambits[0].then, 'hold')
  assert.ok(frames.at(-1).view.tick > frames[0].view.tick)
  assert.ok(f.calls() - before <= 20, 'Frames plus one concurrent input must not read Convex at frame rate')
  assert.ok(frames.every(frame => !frame.s && !frame.log))
  const key = `token:${createHash('sha256').update(session.humanToken).digest('hex')}`
  f.memory.data.delete(key)
  assert.equal((await fetch(`${origin}/stream?${q}`)).status, 401)
})

test('moving gameplay with live human and agent inputs matches canonical replay', async () => {
  const f = fixture(), { q, session } = await match(f), agent = query(session.agentToken)
  await f.game().request('GET', '/next', agent)
  f.advance(12000)
  const initial = await f.game().request('GET', '/state', q)
  const swarm = initial.view.swarms[0]
  assert.ok(swarm)
  await f.game().request('POST', '/input', q, { order: { swarm: swarm.id, x: 600, y: 350 } })
  f.advance(400)
  await f.game().request('POST', '/input', agent, { gambits: [{ if: 'always', then: 'hold' }] })
  f.advance(300)
  const game = f.game(); await game.request('GET', '/state', q)
  f.advance(300)
  const projected = game.projectFrame(q), live = await f.game().request('GET', '/state', q)
  assert.deepEqual(projected.view, live.view, 'Active moving states converge to the same deterministic result')
  assert.notDeepEqual(live.view.swarms.map(s => [s.x, s.y]), initial.view.swarms.map(s => [s.x, s.y]))
  const m = JSON.parse(f.memory.raw(`match:${initial.matchId}`)), log = []
  for (let i = 0; log.length < m.logCount; i++) log.push(...JSON.parse(f.memory.raw(`log:${m.id}:${i}`)))
  f.advance(180000)
  const final = await f.game().request('GET', '/state', q)
  assert.deepEqual(final.view, view(replay(m.s.seed, log, m.s.opts), 0))
  assert.ok(final.report.humanInputs >= 1 && final.report.agentInputs >= 1)
})

test('an event crossing a partial-second checkpoint is durable before its cursor is returned', async () => {
  const f = fixture(), { session, q } = await match(f)
  await f.game().request('GET', '/next', query(session.agentToken))
  const initial = await f.game().request('GET', '/state', q), key = `match:${initial.matchId}`
  const raw = f.memory.raw(key), m = JSON.parse(raw)
  m.s.tick = 2398; m.startsAt = f.now() - 119900
  for (const p of m.players) p.prev = view(m.s, p.side)
  // Keep the checkpoint 100 ms before the 1-minute-left event. A read-only
  // transaction must not let an uncommitted sequence escape to the MCP cursor.
  await f.memory.commit([{ key, raw, value: JSON.stringify(m), ttl: 86400 }])
  f.advance(150)
  const polled = await f.game().request('GET', '/events', query(session.agentToken))
  const event = polled.events.find(e => e.text === '1 minute left.')
  assert.ok(event)
  assert.ok(JSON.parse(f.memory.raw(key)).players[0].seq >= event.seq, 'Returned event cursor must already be committed')
  await f.game().request('POST', '/say', q, { text: 'new human message' })
  const next = await f.game().request('GET', '/events', new URLSearchParams({ token: session.agentToken, since: event.seq }))
  assert.ok(next.events.some(e => e.text.includes('new human message')))
})

test('unchanged agent event poll is one query without presence/CAS rewrites', async () => {
  const f = fixture(), { session } = await match(f), q = query(session.agentToken)
  await f.game().request('GET', '/next', q)
  await f.game().request('GET', '/events', q)
  const calls = f.calls()
  await f.game().request('GET', '/events', q)
  assert.equal(f.calls() - calls, 1)
})
