import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'

test('local agent sees enemy roles once per battalion', { timeout: 150000 }, async t => {
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
  const origin = `http://localhost:${port}`, child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_SEED: '7', BOTTERS_START_DELAY: '1', BOTTERS_HOUSE_BREED: '', BOTTERS_HOUSE_GAMBITS: '' }, stdio: 'ignore' })
  t.after(async () => { child.kill(); if (child.exitCode === null && child.signalCode === null) await new Promise(r => child.once('exit', r)) })
  let up = false; for (let i = 0; i < 100 && !up; i++) { up = await fetch(origin + '/rules').then(r => r.ok, () => false); if (!up) await new Promise(r => setTimeout(r, 25)) }; assert.ok(up)
  const post = (path, b = {}) => fetch(origin + path, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json())
  const s = await post('/session', { setup: 'test' })
  await post(`/play?token=${s.agentToken}`, { vs: 'hard', planets: 9, minutes: 3 })
  await fetch(`${origin}/next?token=${s.agentToken}&timeout=1`)
  const events = () => fetch(`${origin}/events?token=${s.agentToken}&since=0&timeout=1`).then(r => r.json())
  let spotted = []
  for (let i = 0; i < 110 && !spotted.length; i++) {
    await new Promise(r => setTimeout(r, 1000))
    spotted = (await events()).events.filter(e => /^enemy battalion \d+ spotted at/.test(e.text))
  }
  assert.ok(spotted.length, 'opponents meet')
  assert.match(spotted[0].text, /spotted at \(\d+,\d+\): \d+ units \(\d+ runners, \d+ grunts, \d+ tanks\)/)
  await new Promise(r => setTimeout(r, 2200))
  const all = (await events()).events.filter(e => /^enemy battalion \d+ spotted at/.test(e.text))
  const ids = all.map(e => e.text.match(/^enemy battalion (\d+)/)[1])
  assert.equal(new Set(ids).size, ids.length)
})
