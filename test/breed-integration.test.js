import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import * as sim from '../sim.js'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'

test('local house seed and agent breed are in the replay log', async t => {
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  const origin = `http://localhost:${port}`, child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_SEED: '44', BOTTERS_HOUSE_BREED: '', BOTTERS_START_DELAY: '60000', BOTTERS_HOUSE_GAMBITS: '[{"if":"always","then":"hold"}]' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; child.stderr.on('data', d => { stderr += d })
  t.after(async () => { child.kill(); if (child.exitCode === null && child.signalCode === null) await new Promise(r => child.once('exit', r)) })
  let up = false; for (let i = 0; i < 100 && !up; i++) { up = await fetch(origin + '/rules').then(r => r.ok, () => false); if (!up) await new Promise(r => setTimeout(r, 25)) }; assert.ok(up)
  const post = (path, b = {}) => fetch(origin + path, { method: 'POST', body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json() }))
  const s = (await post('/session', { setup: 'test' })).body
  await post(`/play?token=${s.humanToken}`, { withAgent: true })
  assert.equal((await post(`/input?token=${s.agentToken}`, { breed: 'tank', why: 'counter' })).status, 200)
  await post(`/surrender?token=${s.humanToken}`)
  for (let i = 0; i < 50 && !stderr.includes('"log"'); i++) await new Promise(r => setTimeout(r, 20))
  const log = stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).find(e => e.log)?.log
  assert.ok(log)
  assert.ok(log.some(e => e.tick === 0 && e.side === 1 && e.role === 'house' && e.input.breed === sim.BREEDS[44 % 3]))
  assert.ok(log.some(e => e.side === 0 && e.role === 'agent' && e.input.breed === 'tank'))
  assert.deepEqual(sim.replay(44, log).breed, ['tank', sim.BREEDS[44 % 3]])
})

test('online spotted events reveal roles once across cold reloads', async () => {
  let now = 100000
  const store = new MemoryStore(() => now), make = () => new OnlineGame(store, { now: () => now, seed: () => 42 })
  const s = await make().request('POST', '/session', new URLSearchParams(), { setup: 'test' }), h = new URLSearchParams({ token: s.humanToken }), a = new URLSearchParams({ token: s.agentToken })
  await make().request('POST', '/play', h, { withAgent: true, planning: 10 })
  await make().request('GET', '/next', a)
  const id = (await make().request('GET', '/state', h)).matchId
  const snap = JSON.parse(await store.get(`state:${id}`)), state = sim.restore(snap)
  const enemy = state.bats.find(b => b.side === 1), home = state.planets[0]
  for (let i = sim.MAXPER; i < state.N; i++) if (state.alive[i] && state.bat[i] === enemy.id) { state.x[i] = home.x; state.y[i] = home.y }
  enemy.cx = home.x; enemy.cy = home.y
  const record = store.data.get(`state:${id}`); record.value = JSON.stringify(sim.snapshot(state))
  now += 11000
  await make().request('GET', '/state', h)
  const first = await make().request('GET', '/events', a)
  const spotted = first.events.filter(e => e.text.startsWith(`enemy battalion ${enemy.id} spotted at`))
  assert.equal(spotted.length, 1)
  assert.match(spotted[0].text, /\d+ units \(\d+ runners, \d+ grunts, \d+ tanks\)/)
  now += 1000
  await make().request('GET', '/state', h)
  const again = await make().request('GET', '/events', a)
  assert.equal(again.events.filter(e => e.text.startsWith(`enemy battalion ${enemy.id} spotted at`)).length, 1)
})
