import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'

async function fixture(t, delay = '1') {
  const probe = http.createServer()
  await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port
  await new Promise(r => probe.close(r))
  const origin = `http://localhost:${port}`
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: delay }, stdio: 'ignore' })
  t.after(async () => { child.kill('SIGTERM'); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)) })
  let up = false
  for (let i = 0; i < 100 && !up; i++) { up = await fetch(origin + '/rules').then(r => r.ok, () => false); if (!up) await new Promise(r => setTimeout(r, 25)) }
  assert.ok(up, 'Local server failed to start')
  const post = (path, body) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
  const started = async () => {
    const session = await post('/session', { name: 'local-atomicity', setup: 'script' })
    assert.deepEqual(await post(`/play?token=${session.humanToken}`, { vs: 'easy', minutes: 3, withAgent: true, opening: [{ if: 'always', then: 'hold', on: false }, { if: 'always', then: 'hold' }] }), { ok: true })
    await fetch(`${origin}/next?token=${session.agentToken}`).then(r => r.json())
    const read = () => fetch(`${origin}/state?token=${session.humanToken}`).then(r => r.json())
    let state
    for (let i = 0; i < 100; i++) {
      state = await read()
      if (state.view.tick > 0) break
      await new Promise(r => setTimeout(r, 25))
    }
    assert.ok(state.view.tick > 0, 'match must have started before mixed input')
    return { session, read }
  }
  return { origin, post, started }
}

test('unchanged local server serves the shared UI and runs an offline house match', async t => {
  const { origin, post } = await fixture(t)
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

test('local human surrender ends during planning or play, records one result and permits play again', async t => {
  for (const delay of ['60000', '1']) await t.test(delay === '1' ? 'playing' : 'planning', async t => {
    const { origin, post } = await fixture(t, delay)
    const session = await post('/session', { name: 'surrender', setup: 'script' })
    const send = token => fetch(`${origin}/surrender?token=${token}`, { method: 'POST' })
    assert.equal((await send(session.humanToken)).status, 409)
    await post(`/play?token=${session.humanToken}`, { vs: 'easy', minutes: 3, planets: 16, withAgent: true })
    await fetch(`${origin}/next?token=${session.agentToken}&timeout=0`).then(r => r.json())
    if (delay === '1') await new Promise(r => setTimeout(r, 150))
    assert.equal((await send(session.agentToken)).status, 401)
    assert.equal((await send('invalid')).status, 401)
    assert.equal((await send(session.humanToken)).status, 200)
    const read = () => fetch(`${origin}/state?token=${session.humanToken}`).then(r => r.json())
    const end = await read()
    assert.deepEqual(end.view.ended, { reason: 'surrender', result: 'lost' })
    assert.equal(end.report.actual.result, 'lost')
    assert.equal((await send(session.humanToken)).status, 409)
    await new Promise(r => setTimeout(r, 150))
    assert.deepEqual((await read()).view, end.view)
    const events = await fetch(`${origin}/events?token=${session.agentToken}&since=0`).then(r => r.json())
    assert.equal(events.events.filter(e => e.text.includes('match over: you lost (surrender)')).length, 1)
    const lobby = await fetch(`${origin}/lobby?token=${session.humanToken}`).then(r => r.json())
    assert.equal(lobby.live, false); assert.equal(lobby.history.length, 1)
    assert.equal(lobby.history[0].reason, 'surrender')
    assert.deepEqual(await post(`/play?token=${session.humanToken}`, { vs: 'easy' }), { ok: true })
    assert.equal((await read()).view.ended, null)
  })
})

test('local refused gambits plus invalid split preserve strategy and notifications', async t => {
  const { origin, post, started } = await fixture(t)
  for (const role of ['human', 'agent']) await t.test(role, async () => {
    const { session, read } = await started()
    await post(`/call?token=${session.agentToken}`, { swarm: 1, x: 600, y: 350, message: 'keep this call' })
    const before = await read()
    const response = await fetch(`${origin}/input?token=${session[`${role}Token`]}`, { method: 'POST', body: JSON.stringify({ gambits: [{ if: 'always', then: 'go' }], split: -1, why: 'must not apply' }) })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { ok: false, error: 'no swarm -1 of yours' })
    const after = await read()
    assert.deepEqual(after.feed, before.feed)
    assert.deepEqual(after.calls, before.calls)
    assert.deepEqual(after.gambitsBy, before.gambitsBy)
    assert.deepEqual(after.view.gambits, before.view.gambits)
  })
})

test('local refused order plus invalid release preserve swarm control and target', async t => {
  const { origin, post, started } = await fixture(t)
  for (const role of ['human', 'agent']) await t.test(role, async () => {
    const { session, read } = await started()
    const swarm = (await read()).view.swarms[0].id
    await post(`/call?token=${session.agentToken}`, { swarm, x: 600, y: 350, message: 'keep this call' })
    const before = await read()
    const target = frame => {
      const { manual, tx, ty } = frame.view.swarms.find(c => c.id === swarm)
      return { manual, tx, ty }
    }
    const response = await fetch(`${origin}/input?token=${session[`${role}Token`]}`, { method: 'POST', body: JSON.stringify({ order: { swarm, x: 600, y: 350 }, release: -1 }) })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { ok: false, error: 'no swarm -1 of yours' })
    const after = await read()
    assert.deepEqual(after.feed, before.feed)
    assert.deepEqual(after.calls, before.calls)
    assert.deepEqual(after.gambitsBy, before.gambitsBy)
    assert.deepEqual(target(after), target(before))
  })
})

test('local accepted mixed and simple inputs retain ordering, clamping and attribution', async t => {
  const { origin, post, started } = await fixture(t)
  for (const role of ['human', 'agent']) await t.test(role, async () => {
    const { session, read } = await started()
    const before = await read(), swarm = before.view.swarms[0].id
    const input = body => post(`/input?token=${session[`${role}Token`]}`, body)
    await post(`/call?token=${session.agentToken}`, { swarm, x: 600, y: 350, message: 'take this swarm' })
    assert.deepEqual(await input({ gambits: [{ if: 'always', then: 'hold' }], toggle: 0, order: { swarm, x: 1500, y: -10 }, release: swarm }), { ok: true })
    const mixed = await read(), c = mixed.view.swarms.find(c => c.id === swarm)
    assert.deepEqual(mixed.view.gambits, [{ if: 'always', then: 'hold', on: false }])
    assert.equal(c.manual, false)
    assert.equal(c.tx, 1200)
    assert.equal(c.ty, 0)
    assert.equal(mixed.gambitsBy.who, role === 'human' ? 'you' : 'agent')
    assert.equal(mixed.gambitsBy.why, 'switched rule 1 off')
    assert.equal(mixed.calls.length, role === 'human' ? 0 : 1)
    assert.ok(mixed.feed.some(e => e.who === (role === 'human' ? 'you' : 'agent') && e.text.includes('rewrote the gambits')))
    const events = await fetch(`${origin}/events?token=${session.agentToken}&since=0`).then(r => r.json())
    assert.equal(events.events.some(e => e.text.includes('HUMAN took swarm')), role === 'human')
    assert.deepEqual(await input({ order: { swarm, x: -10, y: 800 } }), { ok: true })
    const ordered = (await read()).view.swarms.find(c => c.id === swarm)
    assert.equal(ordered.manual, true)
    assert.equal(ordered.tx, 0)
    assert.equal(ordered.ty, 700)
    assert.deepEqual(await input({ split: swarm }), { ok: true })
    assert.equal((await read()).view.swarms.length, before.view.swarms.length + 1)
    assert.deepEqual(await input({ release: swarm }), { ok: true })
    assert.equal((await read()).view.swarms.find(c => c.id === swarm).manual, false)
    assert.deepEqual(await input({ toggle: 0 }), { ok: true })
    assert.deepEqual((await read()).view.gambits, [{ if: 'always', then: 'hold', on: true }])
  })
})

test('local pre-start refusal still consumes the agent rate budget but permits human gambits', async t => {
  const { origin, post } = await fixture(t, '60000')
  const session = await post('/session', { name: 'local-planning', setup: 'script' })
  assert.deepEqual(await post(`/play?token=${session.humanToken}`, { withAgent: true }), { ok: true })
  const read = () => fetch(`${origin}/state?token=${session.humanToken}`).then(r => r.json())
  const before = await read()
  for (let i = 0; i < 6; i++) {
    const response = await fetch(`${origin}/input?token=${session.agentToken}`, { method: 'POST', body: JSON.stringify({ gambits: [{ if: 'always', then: 'hold' }], split: -1 }) })
    assert.equal(response.status, i < 5 ? 409 : 429)
    assert.deepEqual(await response.json(), { error: i < 5 ? 'match not started: only gambits can change now' : 'max 5 inputs per second' })
  }
  const after = await read()
  assert.equal(after.view.tick, 0)
  assert.deepEqual(after.view.gambits, before.view.gambits)
  assert.deepEqual(after.feed, before.feed)
  assert.deepEqual(after.gambitsBy, before.gambitsBy)
  assert.deepEqual(await post(`/input?token=${session.humanToken}`, { gambits: [{ if: 'always', then: 'hold', on: false }] }), { ok: true })
  assert.deepEqual((await read()).view.gambits, [{ if: 'always', then: 'hold', on: false }])
})
