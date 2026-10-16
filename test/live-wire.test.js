import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@colyseus/sdk'
import { createLiveServer } from '../online/live-server.js'
const sleep = ms => new Promise(r => setTimeout(r, ms))

test('Colyseus sends filtered >=10Hz frames, rejects third-party reservations and survives a drop', async t => {
  const service = await createLiveServer({ origin: 'https://site.example', origins: ['https://site.example'] })
  const address = await service.listen(), origin = `http://127.0.0.1:${address.port}`
  t.after(() => service.close())
  const post = (path, body) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const a = await post('/session', { name: 'wire' }).then(r => r.json())
  const b = await post('/session', { name: 'outsider' }).then(r => r.json())
  assert.equal((await post('/play?token=' + a.humanToken, { vs: 'easy', withAgent: false })).status, 200)
  const { roomId } = await fetch(`${origin}/socket?token=${a.humanToken}`).then(r => r.json())
  assert.equal((await post('/matchmake/create/match', { matchId: 'arbitrary' })).status, 403)
  assert.equal((await post(`/matchmake/joinById/${roomId}`, { token: b.humanToken })).status, 409)
  assert.equal((await fetch(`${origin}/socket?token=${a.agentToken}`)).status, 401)
  assert.equal((await fetch(`${origin}/socket?token=${a.humanToken}`, { headers: { Origin: 'https://evil.example' } })).status, 403)
  const client = new Client(origin)
  let room = await client.joinById(roomId, { token: a.humanToken })
  const times = [], frames = []
  room.onMessage('frame', f => { times.push(performance.now()); frames.push(f) })
  await sleep(1200)
  assert.ok(times.length >= 11)
  assert.ok((times.length - 1) * 1000 / (times.at(-1) - times[0]) >= 10)
  for (const f of frames) { assert.equal(f.s, undefined); assert.equal(f.log, undefined); assert.equal(f.view.enemies.length, 0) }
  const id = frames[0].matchId
  await room.leave(); room = await client.joinById(roomId, { token: a.humanToken })
  const frame = await new Promise(resolve => room.onMessage('frame', resolve))
  assert.equal(frame.matchId, id)
  await room.leave()
  assert.equal(service.runtime.rooms.size, 1)
})
