import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'

test('unchanged local server serves the shared UI and runs an offline house match', async t => {
  const probe = http.createServer()
  await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port
  await new Promise(r => probe.close(r))
  const origin = `http://localhost:${port}`
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1' }, stdio: 'ignore' })
  t.after(async () => { child.kill('SIGTERM'); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)) })
  let up = false
  for (let i = 0; i < 100 && !up; i++) { up = await fetch(origin + '/rules').then(r => r.ok, () => false); if (!up) await new Promise(r => setTimeout(r, 25)) }
  assert.ok(up, 'Local server failed to start')
  const post = (path, body) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
  const session = await post('/session', { name: 'offline-smoke', setup: 'script' })
  const lobby = await fetch(`${origin}/lobby?token=${session.humanToken}`).then(r => r.json())
  assert.equal(lobby.online, undefined)
  assert.ok((await fetch(origin).then(r => r.text())).includes('id="startSolo"'))
  assert.deepEqual(await post(`/play?token=${session.humanToken}`, { vs: 'normal', minutes: 3, planets: 16, withAgent: true }), { ok: true })
  const next = await fetch(`${origin}/next?token=${session.agentToken}&timeout=0`).then(r => r.json())
  assert.ok(next.match.state && next.match.options.planets === 16)
  assert.deepEqual(await post(`/input?token=${session.agentToken}`, { gambits: [{ if: 'always', then: 'hold' }] }), { ok: true })
  await new Promise(r => setTimeout(r, 150))
  const state = await fetch(`${origin}/state?token=${session.humanToken}`).then(r => r.json())
  assert.ok(state.view.tick > 0)
  assert.equal(state.opponent.name, 'house (normal)')
})
