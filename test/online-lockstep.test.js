import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'

test('house duel persists particle state and accepts battalion orders', async () => {
  let now = 100000
  const store = new MemoryStore(() => now)
  const game = new OnlineGame(store, { now: () => now, seed: () => 42 })
  const session = await game.request('POST', '/session', new URLSearchParams(), { name: 'A' })
  const q = new URLSearchParams({ token: session.humanToken })
  await game.request('POST', '/play', q, { vs: 'hard', withAgent: false, planning: 10 })
  now += 11000
  const frame = await game.request('GET', '/state', q)
  assert.equal(frame.opponent.name, 'house (hard · flanker)')
  assert.equal(frame.view.battalions.length > 0, true)
  const bat = frame.view.battalions[0].id
  assert.deepEqual(await game.request('POST', '/input', q, { order: { bat, x: 300, y: 350 } }), { ok: true })
  const cold = new OnlineGame(store, { now: () => now, seed: () => 42 })
  assert.equal((await cold.request('GET', '/state', q)).view.battalions.find(b => b.id === bat).manual, true)
})

import { runtime, client, ORIGIN } from './helpers/cloudflare.js'
import { createReplica } from '../browser-live.js'
import * as sim from '../sim.js'

test('cold catch-up returns bounded progress and checkpoints survive repeated eviction', async () => {
  let now = 100000
  const store = new MemoryStore(() => now)
  const make = () => new OnlineGame(store, { now: () => now, seed: () => 42 })
  const session = await make().request('POST', '/session', new URLSearchParams(), { name: 'A' })
  const q = new URLSearchParams({ token: session.humanToken })
  await make().request('POST', '/play', q, { vs: 'normal', withAgent: false, planning: 10, planets: 9 })
  const matchId = (await make().request('GET', '/state', q)).matchId
  const initial = await make().request('INTERNAL', '/tick', new URLSearchParams(), { id: matchId, snap: true })
  now += 25000
  let previous = 0, current
  do {
    current = await make().request('INTERNAL', '/tick', new URLSearchParams(), { id: matchId, snap: true })
    assert.ok(current.tick > previous && current.tick - previous <= 100, `unbounded progress ${previous} -> ${current.tick}`)
    previous = current.tick
  } while (current.tick < 300)
  const expected = sim.restore(initial.state)
  sim.advanceTo(expected, current.tick)
  assert.equal(sim.hash(sim.restore(current.state)), sim.hash(expected))
})

const waitFor = async (predicate, ms = 45000) => {
  const end = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for lockstep')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
test('workerd two-player replicas receive indexed inputs, hashes and resync', { timeout: 90000 }, async t => {
  const { mf, mail } = await runtime(); t.after(() => mf.dispose())
  const players = []
  for (const name of ['One', 'Two']) {
    const c = client(mf); assert.equal((await c.signUp(name)).status, 200)
    const verify = new URL(mail.at(-1).text.match(/http:\/\/[^\s]+/)[0])
    await c.call('GET', verify.pathname + verify.search)
    const session = (await c.call('POST', '/session', {})).body
    assert.equal((await c.call('POST', '/exchange', { ticket: session.liveTicket })).status, 200)
    players.push({ c, token: session.humanToken, bytes: 0, snaps: 0, resyncs: 0, hashes: 0, result: null })
  }
  const [a,b] = players
  const room = await a.c.call('POST', `/rooms?token=${a.token}`, { withAgent: false, planning: 10, minutes: 3, planets: 9 })
  assert.equal(room.status, 200)
  assert.equal((await b.c.call('POST', `/rooms/join?token=${b.token}`, { code: room.body.code, withAgent: false })).status, 200)
  assert.equal((await a.c.call('POST', `/rooms/start?token=${a.token}`, {})).status, 200)
  for (const p of players) {
    const response = await mf.dispatchFetch(ORIGIN + `/socket?token=${p.token}`, { headers: { upgrade: 'websocket', origin: ORIGIN, cookie: [...p.c.cookies].map(([k,v]) => `${k}=${v}`).join('; ') } })
    assert.equal(response.status, 101)
    p.ws = response.webSocket
    p.replica = createReplica(sim, () => { p.resyncs++; p.ws.send(JSON.stringify({ t: 'resync' })) })
    p.ws.addEventListener('message', e => {
      p.bytes += Buffer.byteLength(e.data)
      const message = JSON.parse(e.data)
      if (message.t === 'snap') p.snaps++
      if (message.t === 'step' && message.hash) p.hashes++
      if (message.t === 'meta' && message.result) p.result = message.result
      p.replica.receive(message); p.replica.advance(10000)
    })
    p.ws.accept(); t.after(() => p.ws.close())
  }
  const start = performance.now()
  await waitFor(() => players.every(p => p.replica.state?.tick >= 20))
  for (const p of players) {
    const bat = sim.view(p.replica.state, p.replica.side).battalions[0].id
    const order = await p.c.call('POST', `/input?token=${p.token}`, { order: { bat, x: 600, y: 350 } })
    assert.equal(order.status, 200, JSON.stringify(order.body))
  }
  await waitFor(() => players.every(p => p.replica.state?.tick >= 220))
  assert.deepEqual(players.map(p => p.resyncs), [0,0])
  assert.ok(players.every(p => p.hashes >= 10))
  a.ws.send(JSON.stringify({ t: 'resync' }))
  await waitFor(() => a.snaps >= 2)
  const tick = a.replica.state.tick
  await waitFor(() => a.replica.state.tick >= tick + 20)
  assert.equal(a.resyncs, 0)
  assert.equal((await a.c.call('POST', `/surrender?token=${a.token}`, {})).status, 200)
  await waitFor(() => players.every(p => p.result))
  assert.deepEqual(players.map(p => p.result.result), ['lost', 'won'])
  const seconds = (performance.now() - start) / 1000
  const rates = players.map(p => p.bytes / seconds / 1024)
  assert.ok(rates.every(rate => rate < 100))
  console.log(JSON.stringify({ proof: 'workerd-lockstep', kbPerSecond: rates, ticks: players.map(p => p.replica.state.tick) }))
})
