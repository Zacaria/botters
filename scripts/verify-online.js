// Actual stdio MCP processes, not simulated tool responses. No inference, no private output.
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { performance } from 'node:perf_hooks'
const base = process.env.BOTTERS_SERVER
if (!base) throw new Error('Set BOTTERS_SERVER to the preview/production URL (or a local online development harness).')
const previewHeaders = new URL(base).hostname.endsWith('.vercel.app') && process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}
const startedAt = performance.now(), run = Date.now().toString(36), clients = [], humanTokens = [], latency = []
const parse = result => {
  if (result.isError) throw new Error(result.content?.map(c => c.text || '').join('\n') || 'MCP tool failed')
  return JSON.parse(result.content.find(c => c.type === 'text').text)
}
const tool = async (c, name, args = {}) => parse(await c.callTool({ name, arguments: args }, undefined, { timeout: 60000 }))
const request = async (path, body) => {
  const start = performance.now()
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...previewHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(55000) })
  const data = await r.json(); assert.equal(r.status, 200, data.error); latency.push(performance.now() - start); return data
}
try {
  for (let side = 0; side < 2; side++) {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['client.js'], env: { BOTTERS_SERVER: base, BOTTERS_NAME: `verify-${run}-${side}`, BOTTERS_SETUP: 'scripted-MCP', BOTTERS_OPEN: '0', ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { VERCEL_AUTOMATION_BYPASS_SECRET: process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) }, stderr: 'pipe' })
    let log = ''
    transport.stderr.on('data', chunk => {
      log += chunk.toString(); const match = /lobby (https?:\/\/\S+)/.exec(log)
      if (match) { humanTokens[side] = new URL(match[1]).searchParams.get('s'); log = '' }
      if (log.length > 4096) log = ''
    })
    const client = new Client({ name: 'botters-online-verification', version: '1.0.0' })
    await client.connect(transport); clients.push(client)
    assert.ok((await client.listTools()).tools.some(t => t.name === 'join_match'))
  }
  const matches = await Promise.all(clients.map(c => tool(c, 'join_match', { vs: 'player', minutes: 3, planets: 40, planning: 20 })))
  assert.ok(matches.every(m => m.state && m.rules && m.doctrine))
  assert.ok(matches.every(m => m.settings.planets === 40))
  await Promise.all(clients.map(c => tool(c, 'set_gambits', { gambits: [{ if: 'always', then: 'hold' }], why: 'verify a complete timed online match' })))
  assert.ok(humanTokens.every(Boolean))
  const initial = await Promise.all(humanTokens.map(t => request(`/state?token=${t}`)))
  assert.equal(initial[0].matchId, initial[1].matchId)
  assert.notEqual(initial[0].me.name, initial[1].me.name)
  assert.ok(initial.every(s => !s.s && !s.log))
  const stream = async token => {
    const controller = new AbortController(), times = []
    const res = await fetch(`${base}/stream?token=${token}`, { headers: previewHeaders, signal: controller.signal })
    assert.equal(res.status, 200)
    let buffered = ''
    try {
      for await (const chunk of res.body) {
        buffered += new TextDecoder().decode(chunk)
        let pos
        while ((pos = buffered.indexOf('\n\n')) >= 0) {
          const event = buffered.slice(0, pos); buffered = buffered.slice(pos + 2)
          if (event.startsWith('data: ')) {
            const frame = JSON.parse(event.slice(6)); assert.ok(frame.view); assert.equal(frame.s, undefined)
            times.push(performance.now())
            if (times.length >= 40) { controller.abort(); break }
          }
        }
        if (times.length >= 40) break
      }
    } catch (e) { if (!controller.signal.aborted) throw e } finally { controller.abort() }
    assert.ok(times.length >= 40, 'Stream closed before 40 frames')
    return { frames: times.length, fps: (times.length - 1) * 1000 / (times.at(-1) - times[0]) }
  }
  const streams = Promise.all(humanTokens.map(stream))
  // Cold/repeated HTTP reads exercise the same match while both agent processes poll.
  for (let i = 0; i < 30; i++) await request(`/state?token=${humanTokens[i % 2]}`)
  const cadence = await streams
  const deadline = Date.now() + 240000
  let states
  do {
    states = await Promise.all(clients.map(c => tool(c, 'wait_for_event', { timeout_s: 10 })))
    if (states.every(s => s.state?.ended)) break
    assert.ok(Date.now() < deadline, 'Full online match timed out')
  } while (true)
  const final = await Promise.all(humanTokens.map(t => request(`/state?token=${t}`)))
  assert.ok(final.every(f => f.view.ended && f.report?.actual && f.report.agentInputs >= 1))
  const lobbies = await Promise.all(humanTokens.map(t => request(`/lobby?token=${t}`)))
  assert.ok(lobbies.every(l => l.history.some(h => h.matchId === initial[0].matchId)))
  latency.sort((a, b) => a - b)
  console.log(JSON.stringify({ server: base, matchId: initial[0].matchId, clients: 2, transport: 'real stdio MCP', elapsedMs: performance.now() - startedAt, results: final.map(f => f.report.actual), streams: cadence, requestSamples: latency.length, requestP95Ms: latency[Math.ceil(latency.length * .95) - 1], note: 'Same-host clients; not two physical machines/networks. 3-minute/40-planet functional test, not the 8-minute/80-swarm capacity fixture.' }, null, 2))
} finally { await Promise.allSettled(clients.map(c => c.close())) }
