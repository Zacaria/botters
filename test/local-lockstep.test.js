import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './local.test.js'
import * as sim from '../sim.js'
import { createReplica } from '../browser-live.js'

test('real SSE replicas remain in lockstep across a mid-match join', {timeout: 45000}, async t => {
  const {origin, post} = await fixture(t), session = (await post('/session', {})).body, token = session.humanToken
  assert.equal((await post(`/play?token=${token}`, {vs:'normal', minutes:3, planets:9, withAgent:false})).status, 200)
  const controllers = [], replicas = [], done = []
  const connect = async () => {
    const controller = new AbortController(); controllers.push(controller); const res = await fetch(`${origin}/stream?token=${token}`, {signal:controller.signal}); assert.equal(res.status, 200)
    let resync = 0, snaps = 0, steps = 0, lastTick = 0, checked = 0, bytes = 0, buf = ''; const replica = createReplica(sim, () => resync++); replicas.push(replica)
    const reader = res.body.getReader(), decoder = new TextDecoder()
    const task = (async () => { try { while (true) { const {value, done} = await reader.read(); if (done) break; bytes += value.length; buf += decoder.decode(value, {stream:true}); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const part = buf.slice(0,i); buf = buf.slice(i+2); if (!part.startsWith('data: ')) continue; const msg = JSON.parse(part.slice(6)); if (msg.t === 'snap') snaps++; if (msg.t === 'step') { steps++; lastTick=msg.tick; assert.ok(!JSON.stringify(msg).includes('units')); } replica.receive(msg); if (msg.t === 'step') { replica.advance(10000); if (msg.hash && replica.state.tick === msg.hash[0]) { assert.equal(sim.hash(replica.state), msg.hash[1]); checked++ } } } } } catch (e) { if (e.name !== 'AbortError' && !(e.message === 'terminated' && lastTick >= 220)) throw e } })(); done.push(task)
    return { get tick() { return lastTick }, get checked() { return checked }, get resync() { return resync }, get snaps() { return snaps }, get bytes() { return bytes }, get steps() { return steps } }
  }
  t.after(async () => { controllers.forEach(c => c.abort()); await Promise.all(done) })
  const first = await connect(); await new Promise(r => setTimeout(r, 1800))
  assert.equal((await post(`/input?token=${token}`, {order:{bat:0,x:400,y:300}})).status, 200)
  const second = await connect(); await new Promise(r => setTimeout(r, 700))
  assert.equal((await post(`/input?token=${token}`, {release:0})).status, 200)
  for (let i=0; i<300 && (first.tick < 220 || second.tick < 220); i++) await new Promise(r=>setTimeout(r,50))
  assert.ok(first.tick >= 220 && second.tick >= 220); assert.ok(first.checked >= 8 && second.checked >= 6); assert.equal(first.resync, 0); assert.equal(second.resync, 0); assert.equal(first.snaps, 1); assert.equal(second.snaps,1)
})
