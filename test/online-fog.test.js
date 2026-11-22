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
import { createMirror, decodeFrame } from '../wire.js'
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
  const expected = structuredClone(initial.state)
  sim.advanceTo(expected, current.tick)
  assert.equal(sim.hash(current.state), sim.hash(expected))
})

const waitFor = async (predicate, ms = 45000) => {
  const end = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for lockstep')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
test('workerd two-player fog frames decode and resync', { timeout: 90000 }, async t => {
  const { mf, mail } = await runtime(); t.after(() => mf.dispose())
  const players = []
  for (const name of ['One', 'Two']) {
    const c = client(mf); assert.equal((await c.signUp(name)).status, 200)
    const verify = new URL(mail.at(-1).text.match(/http:\/\/[^\s]+/)[0])
    await c.call('GET', verify.pathname + verify.search)
    const session = (await c.call('POST', '/session', {})).body
    assert.equal((await c.call('POST', '/exchange', { ticket: session.liveTicket })).status, 200)
    players.push({ c, token: session.humanToken, bytes: 0, resets: 0, error: null, result: null })
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
    p.mirror = createMirror()
    p.ws.addEventListener('message', e => {
      if (typeof e.data === 'string') { p.bytes += Buffer.byteLength(e.data); const message = JSON.parse(e.data); if (message.result) p.result = message.result; return }
      const bytes = new Uint8Array(e.data); p.bytes += bytes.length
      try { if (bytes[0] & 1) p.resets++; decodeFrame(bytes, p.mirror) } catch (e) { p.error = e }
    })
    p.ws.accept(); t.after(() => p.ws.close())
  }
  const start = performance.now()
  await waitFor(() => players.every(p => p.mirror.tick >= 20))
  for (const p of players) {
    const bat = p.mirror.bat[p.mirror.has.findIndex((v, i) => v && (i < sim.MAXPER ? 0 : 1) === p.mirror.side)]
    const order = await p.c.call('POST', `/input?token=${p.token}`, { order: { bat, x: 600, y: 350 } })
    assert.equal(order.status, 200, JSON.stringify(order.body))
  }
  await waitFor(() => players.every(p => p.mirror.tick >= 220))
  for (const p of players) { assert.ifError(p.error); assert.ok(p.mirror.n > 0); assert.equal(p.resets, 1) }
  a.ws.send(JSON.stringify({ t: 'resync' }))
  await waitFor(() => a.resets >= 2)
  const tick = a.mirror.tick
  await waitFor(() => a.mirror.tick >= tick + 20)
  assert.ifError(a.error)
  assert.equal((await a.c.call('POST', `/surrender?token=${a.token}`, {})).status, 200)
  await waitFor(() => players.every(p => p.result))
  assert.deepEqual(players.map(p => p.result.result), ['lost', 'won'])
  const seconds = (performance.now() - start) / 1000
  const rates = players.map(p => p.bytes / seconds / 1024)
  assert.ok(rates.every(rate => rate < 100))
  console.log(JSON.stringify({ proof: 'workerd-fog', kbPerSecond: rates, ticks: players.map(p => p.mirror.tick) }))
})
