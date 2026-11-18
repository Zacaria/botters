import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

async function fixture(t) {
  const reservation = net.createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port, origin = `http://127.0.0.1:${port}`
  await new Promise(resolve => reservation.close(resolve))
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '60000' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit') } })
  await Promise.race([
    (async () => { while (!stderr.includes('botters server on')) { if (child.exitCode !== null) throw new Error(stderr); await new Promise(resolve => setTimeout(resolve, 10)) } })(),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 5000); timer.unref() }),
  ])
  const api = async (path, token, data) => {
    const response = await fetch(`${origin}${path}${path.includes('?') ? '&' : '?'}token=${token || ''}`, data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
    return { status: response.status, body: await response.json() }
  }
  const session = async () => (await api('/session', null, { name: 'Preparation HTTP' })).body
  return { api, session }
}

test('offline queue revalidates both saved openings against current doctrine and final settings', async t => {
  const { api, session } = await fixture(t)
  for (const change of ['doctrine', 'minutes']) {
    const a = await session(), b = await session(), first = { ...options, vs: 'player' }
    const second = { ...first, minutes: change === 'minutes' ? 8 : first.minutes }
    for (const [s, opts] of [[a, first], [b, second]]) {
      const { preparation } = (await api('/prepare', s.humanToken, opts)).body
      assert.equal((await api('/input', s.agentToken, { preparationId: preparation.id, gambits: opening })).status, 200)
    }
    assert.equal((await api('/play', a.humanToken, first)).status, 200)
    if (change === 'doctrine') await api('/profile', a.humanToken, { doctrine: 'A new strategy after queuing.' })
    assert.equal((await api('/play', b.humanToken, second)).status, 409)
    const aa = (await api('/lobby', a.humanToken)).body, bb = (await api('/lobby', b.humanToken)).body
    assert.equal(aa.queued, true); assert.equal(bb.queued, false)
    assert.equal(aa.inMatch, false); assert.equal(bb.inMatch, false)
    await api('/cancel', a.humanToken, {})
  }
})

// Real HTTP only: each fixture owns its child and an OS-assigned port.
test('prepare wakes a waiting agent, saves privately without a match, then starts at tick zero after presence expires', { timeout: 100000 }, async t => {
  const { api, session } = await fixture(t), { humanToken, agentToken } = await session()
  let answered = false
  const next = api('/next?timeout=4', agentToken).then(result => { answered = true; return result })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(answered, false)
  const prepared = await api('/prepare', humanToken, { ...options, opening })
  assert.equal(prepared.status, 200)
  const { preparation } = (await next).body
  assert.ok(preparation?.id)
  assert.equal(preparation.gambits, null)
  assert.equal(preparation.options.opening, undefined)
  assert.equal(preparation.options.minutes, 3)
  assert.equal((await api('/next?timeout=0.001', agentToken)).body.match, null)
  assert.equal((await api('/state', humanToken)).status, 409)
  assert.equal((await api('/lobby', humanToken)).body.preparation.ready, false)
  assert.equal((await api('/input', humanToken, { preparationId: preparation.id, gambits: opening })).status, 403)
  assert.equal((await api('/input', agentToken, { gambits: opening })).status, 409)
  const saved = await api('/input', agentToken, { preparationId: preparation.id, gambits: opening, why: 'Hold the line' })
  assert.equal(saved.status, 200)
  assert.equal((await api('/next?timeout=0.001', agentToken)).body.preparation.ready, true)
  let lobby = (await api('/lobby', humanToken)).body
  assert.equal(lobby.preparation.ready, true)
  assert.deepEqual(lobby.preparation.gambits, canonicalOpening)
  assert.equal(lobby.preparation.why, 'Hold the line')
  assert.equal(lobby.inMatch, false)
  assert.equal(lobby.queued, false)
  const other = await session()
  assert.equal((await api('/lobby', other.humanToken)).body.preparation, null)
  // Stop all agent requests and cross the real offline presence TTL.
  await new Promise(resolve => setTimeout(resolve, 90100))
  lobby = (await api('/lobby', humanToken)).body
  assert.equal(lobby.agent, null)
  assert.equal(lobby.preparation.ready, true)
  assert.equal((await api('/state', humanToken)).status, 409, 'preparation never creates a countdown or match')
  assert.equal((await api('/play', humanToken, options)).status, 200)
  const state = (await api('/state', humanToken)).body
  assert.equal(state.view.tick, 0)
  assert.deepEqual(state.view.gambits, canonicalOpening)
  assert.deepEqual(state.gambitsBy, { who: 'agent', t: 0, why: 'Hold the line' })
  assert.equal(state.me.agentJoined, false)
  assert.equal(state.me.withAgent, true)
  assert.equal((await api('/prepare', humanToken, options)).status, 409)
  assert.equal((await api('/next?timeout=0.001', agentToken)).body.match.openingBy, 'prepared')
})

test('invalid and stale saves never mark ready or replace the current preparation', async t => {
  const { api, session } = await fixture(t), { humanToken, agentToken } = await session()
  assert.equal((await api('/prepare', agentToken, options)).status, 401)
  assert.equal((await api('/prepare', humanToken, options)).status, 200)
  const first = (await api('/next?timeout=0.001', agentToken)).body.preparation
  for (const gambits of [[], [{ if: 'made_up', then: 'hold' }], [{ if: 'always', then: 'made_up' }], [{ if: 'enemy_near', p: -1, then: 'go' }]]) {
    assert.equal((await api('/input', agentToken, { preparationId: first.id, gambits })).status, 400)
    assert.equal((await api('/lobby', humanToken)).body.preparation.ready, false)
  }
  assert.equal((await api('/input', agentToken, { preparationId: first.id, gambits: opening })).status, 200)
  assert.equal((await api('/play', humanToken, { ...options, minutes: 5 })).status, 409)
  assert.equal((await api('/play', humanToken, { ...options, planning: 20 })).status, 409)
  await api('/profile', humanToken, { doctrine: 'A changed doctrine' })
  assert.equal((await api('/lobby', humanToken)).body.preparation.ready, false)
  assert.equal((await api('/input', agentToken, { preparationId: first.id, gambits: opening })).status, 409)
  assert.equal((await api('/play', humanToken, options)).status, 409)
  await api('/prepare', humanToken, options)
  const second = (await api('/next?timeout=0.001', agentToken)).body.preparation
  assert.notEqual(second.id, first.id)
  assert.equal((await api('/input', agentToken, { preparationId: first.id, gambits: opening })).status, 409)
  assert.equal((await api('/lobby', humanToken)).body.preparation.ready, false)
  assert.equal((await api('/input', agentToken, { preparationId: second.id, gambits: opening })).status, 200)
  assert.equal((await api('/input', agentToken, { preparationId: first.id, gambits: [{ if: 'always', then: 'go' }] })).status, 409)
  const lobby = (await api('/lobby', humanToken)).body
  assert.equal(lobby.preparation.id, second.id)
  assert.equal(lobby.preparation.ready, true)
  assert.deepEqual(lobby.preparation.gambits, canonicalOpening)
  assert.equal((await api('/play', humanToken, options)).status, 200)
})

test('solo defaults, manual openings, queue guards and explicit headless agent play remain available', async t => {
  const { api, session } = await fixture(t)
  for (const withAgent of [undefined, false, 'true']) {
    const { humanToken } = await session()
    assert.equal((await api('/play', humanToken, { ...options, withAgent })).status, 200)
    assert.equal((await api('/state', humanToken)).body.me.withAgent, false)
  }
  const manual = await session()
  assert.equal((await api('/play', manual.humanToken, { ...options, opening })).status, 200)
  const state = (await api('/state', manual.humanToken)).body
  assert.deepEqual(state.view.gambits, canonicalOpening)
  assert.equal(state.gambitsBy.who, 'you')
  assert.equal((await api('/next?timeout=0.001', manual.agentToken)).body.match.openingBy, 'human')
  const headless = await session()
  assert.equal((await api('/play', headless.agentToken, options)).status, 200)
  assert.equal((await api('/next?timeout=0.001', headless.agentToken)).body.match.openingBy, 'agent')
  const queued = await session()
  assert.equal((await api('/play', queued.humanToken, { ...options, withAgent: false, vs: 'player' })).body.queued, true)
  assert.equal((await api('/prepare', queued.humanToken, options)).status, 409)
  assert.equal((await api('/lobby', queued.humanToken)).body.queued, true)
})

const opening = [{ if: 'always', then: 'hold' }]
const canonicalOpening = [{ if: 'always', then: 'hold', on: true }]
const options = { mode: '1v1', vs: 'easy', minutes: 3, planets: 16, planning: 10, withAgent: true }

test('human agent-led play refuses an unprepared opening without starting or queuing', async t => {
  const { api, session } = await fixture(t), { humanToken } = await session()
  for (const vs of ['easy', 'player']) {
    const result = await api('/play', humanToken, { ...options, vs })
    assert.equal(result.status, 409)
    assert.match(result.body.error, /prepar/i)
    const lobby = (await api('/lobby', humanToken)).body
    assert.equal(lobby.inMatch, false)
    assert.equal(lobby.queued, false)
    assert.equal((await api('/state', humanToken)).status, 409)
  }
})
