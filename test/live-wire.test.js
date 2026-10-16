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
  assert.equal((await fetch(`${origin}/leaderboard`)).status, 200)
  const a = await post('/session', { name: 'wire' }).then(r => r.json())
  const b = await post('/session', { name: 'outsider' }).then(r => r.json())
  assert.equal((await post('/play?token=' + a.humanToken, { vs: 'easy', withAgent: false })).status, 200)
  const { roomId } = await fetch(`${origin}/socket?token=${a.humanToken}`).then(r => r.json())
  assert.equal((await post('/matchmake/create/match', { matchId: 'arbitrary' })).status, 403)
  assert.equal((await post(`/matchmake/joinById/${roomId}`, { token: b.humanToken })).status, 409)
  assert.equal((await fetch(`${origin}/socket?token=${a.agentToken}`)).status, 401)
  assert.equal((await post(`/agent/revoke?token=${a.humanToken}`, {})).status, 404)
  assert.equal((await post('/?route=/auth/sign-up/email', {})).status, 400)
  await assert.rejects(createLiveServer({ requireAccount: true }), /reviewed live-session exchange/)
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
  let unknownLookups = 0
  service.runtime.options.authority = async (_key, adopt) => {
    unknownLookups++
    await adopt({ token: null, session: null, expiresAt: Date.now() + 60000 })
    return { checkedAt: Date.now(), expiresAt: Date.now() + 60000, connected: () => true, close: async () => {} }
  }
  for (let i = 0; i < 41; i++) {
    const r = await fetch(`${origin}/lobby?token=${'x'.repeat(32)}`)
    assert.equal(r.status, i < 40 ? 401 : 429)
  }
  assert.equal(unknownLookups, 40, 'Unknown capabilities cannot open unbounded Convex authorization channels')
})
