// Two actual stdio MCP agents. Scripted policies, no model inference or fabricated replies.
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Client as ColyseusClient } from '@colyseus/sdk'
import { writeFile } from 'node:fs/promises'
const base = process.env.BOTTERS_SERVER
if (!base) throw new Error('Set BOTTERS_SERVER to the live server (or the local Colyseus harness).')
const minutes = Number(process.env.BOTTERS_MINUTES || 8)
const started = performance.now(), run = Date.now().toString(36), clients = [], humans = [], latency = [], sockets = []
const parse = result => {
  const text = result.content.find(c => c.type === 'text').text
  if (result.isError) throw new Error(text)
  try { return JSON.parse(text) } catch { throw new Error(text) }
}
const tool = async (c, name, args = {}) => parse(await c.callTool({ name, arguments: args }, undefined, { timeout: 60000 }))
const request = async (path, body) => {
  const at = performance.now(), r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body), signal: AbortSignal.timeout(55000) })
  const data = await r.json(); assert.equal(r.status, 200, data.error); latency.push(performance.now() - at); return data
}
try {
  const before = (await request('/health')).convex
  for (let side = 0; side < 2; side++) {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['client.js'], env: { ...process.env, BOTTERS_SERVER: base, BOTTERS_NAME: `live-${run}-${side}`, BOTTERS_SETUP: 'scripted-MCP', BOTTERS_OPEN: '0' }, stderr: 'pipe' })
    let log = ''
    transport.stderr.on('data', chunk => { log += chunk; const m = /lobby (https?:\/\/\S+)/.exec(log); if (m) { humans[side] = new URL(m[1]).searchParams.get('s'); log = '' } if (log.length > 4096) log = '' })
    const client = new Client({ name: 'botters-live-verification', version: '1.0.0' })
    await client.connect(transport); clients.push(client)
    assert.ok((await client.listTools()).tools.some(t => t.name === 'join_match'))
  }
  const matches = await Promise.all(clients.map(c => tool(c, 'join_match', { vs: 'player', minutes, planets: 40, planning: 10 })))
  assert.ok(matches.every(m => m.state && m.rules && m.doctrine && m.settings.minutes === minutes))
  await Promise.all(clients.map(c => tool(c, 'set_gambits', { gambits: [{ if: 'always', then: 'hold' }], why: 'verify the complete timed match' })))
  assert.ok(humans.every(Boolean))
  const initial = await Promise.all(humans.map(t => request(`/state?token=${t}`)))
  assert.equal(initial[0].matchId, initial[1].matchId)
  assert.ok(initial.every(s => !s.s && !s.log && !s.report))
  const cadence = [], totals = [0, 0], socketClient = new ColyseusClient(base)
  const open = async (side, collect = true) => {
    const { roomId } = await request(`/socket?token=${humans[side]}`), room = await socketClient.joinById(roomId, { token: humans[side] }), times = []
    sockets.push(room)
    room.onMessage('unavailable', () => {})
    room.onMessage('frame', frame => {
      assert.equal(frame.matchId, initial[side].matchId); assert.equal(frame.s, undefined); assert.equal(frame.log, undefined)
      totals[side]++; if (collect && times.length < 100) times.push(performance.now())
    })
    return { room, times }
  }
  const views = await Promise.all([open(0), open(1)])
  await new Promise(r => setTimeout(r, 9000))
  for (const { times } of views) { const fps = (times.length - 1) * 1000 / (times.at(-1) - times[0]); assert.ok(fps >= 10); cadence.push({ frames: times.length, fps }) }
  await views[0].room.leave(); await new Promise(r => setTimeout(r, 1200)); await open(0, false)
  assert.equal((await request(`/state?token=${humans[0]}`)).matchId, initial[0].matchId)
  const deadline = Date.now() + minutes * 60000 + 60000
  let events = 0
  do {
    const states = await Promise.all(clients.map(c => tool(c, 'wait_for_event', { timeout_s: 10 })))
    events += states.reduce((n, s) => n + (s.events?.length || 0), 0)
    if (states.every(s => s.state?.ended)) break
    assert.ok(Date.now() < deadline, 'Full timed match exceeded its deadline')
  } while (true)
  const final = await Promise.all(humans.map(t => request(`/state?token=${t}`)))
  assert.ok(final.every(f => f.view.ended && f.report?.actual && f.report.agentInputs >= 1))
  assert.ok(final.every(f => f.view.tick === minutes * 60 * 20), 'Match did not run the full requested duration')
  const lobbies = await Promise.all(humans.map(t => request(`/lobby?token=${t}`)))
  assert.ok(lobbies.every(l => l.history.filter(h => h.matchId === initial[0].matchId).length === 1))
  const after = (await request('/health')).convex
  const counts = before && Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]]))
  const calls = counts ? counts.query + counts.mutation + counts.updates : 0
  assert.ok(!counts || calls <= 50, `Convex calls ${calls} exceed 50`)
  const elapsedMs = performance.now() - started
  if (process.env.BOTTERS_UNACCELERATED) assert.ok(elapsedMs >= minutes * 60000)
  latency.sort((a, b) => a - b)
  const result = { server: base, matchId: initial[0].matchId, minutes, planets: 40, clients: 2, transport: 'two real stdio MCP agents + Colyseus WebSockets', elapsedMs, results: final.map(f => f.report.actual), streams: cadence, framesReceived: totals, reconnectSameMatch: true, historyExactlyOnce: true, convex: counts && { ...counts, total: calls, counting: 'query REST + mutation REST + delivered authorization query results (includes initial/reconnect results); subscription initiations are not double-counted' }, requestP95Ms: latency[Math.ceil(latency.length * .95) - 1], events, note: 'Same-host scripted clients, not model inference or two physical networks. Full duration with hold gambits avoids an early wipe.' }
  if (process.env.BOTTERS_VERIFY_OUTPUT) await writeFile(process.env.BOTTERS_VERIFY_OUTPUT, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally { await Promise.allSettled(sockets.map(r => r.leave())); await Promise.allSettled(clients.map(c => c.close())) }
