import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'

export async function fixture(t, delay = '1') {
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  const origin = `http://localhost:${port}`, child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: delay }, stdio: 'ignore' })
  t.after(async () => { child.kill(); if (child.exitCode === null && child.signalCode === null) await new Promise(r => child.once('exit', r)) })
  let up = false; for (let i = 0; i < 100 && !up; i++) { up = await fetch(origin + '/rules').then(r => r.ok, () => false); if (!up) await new Promise(r => setTimeout(r, 25)) }; assert.ok(up)
  const post = (path, data = {}) => fetch(origin + path, { method: 'POST', body: JSON.stringify(data) }).then(async r => ({ status: r.status, body: await r.json() }))
  return { origin, post }
}

test('local house planning, inputs and surrender', async t => {
  const {origin, post} = await fixture(t, '60000'), session = (await post('/session', {setup:'test'})).body
  const h = session.humanToken, a = session.agentToken
  assert.equal((await post(`/play?token=${h}`, {vs:'hard', planets:9, minutes:3, withAgent:true})).status, 200)
  const get = () => fetch(`${origin}/state?token=${h}`).then(r => r.json())
  const before = await get(); assert.equal(before.opponent.name, 'house (hard · flanker)'); assert.equal(before.view.battalions.length, 3)
  assert.equal((await post(`/input?token=${a}`, {order:{bat:0,x:300,y:300}})).status, 409)
  assert.equal((await post(`/input?token=${h}`, {toggle:0})).status, 200)
  assert.equal((await post(`/input?token=${h}`, {toggle:0, release:0})).status, 409)
  assert.equal((await post(`/surrender?token=${h}`)).status, 200)
  const after = await get(); assert.equal(after.report.result, 'lost'); assert.equal(after.report.reason, 'surrender')
  assert.equal((await fetch(`${origin}/lobby?token=${h}`).then(r=>r.json())).history.length, 1)
  assert.equal((await post(`/surrender?token=${h}`)).status, 409)
})
