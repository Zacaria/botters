// Real-agent bench: Claude Code, through the stdio MCP client (client.js), plays a real-time match on a local server
// whose house plays a fixed gambit list. One server per match, fixed seed, so every condition sees the same maps.
// node scripts/agent-value/agent-bench.mjs --set best --seeds 1,2,3 --out docs/agent-value/raw/agent/run1 [--parallel 4] [--model sonnet] [--brief default] [--minutes 5] [--house-script counter]
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SETS } from './strategies.mjs'
import { BRIEFS } from './briefs.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const setName = arg('set', 'best'), seeds = arg('seeds', '1').split(',').map(Number), out = arg('out', 'agent-run'), parallel = +arg('parallel', 4)
const houseScript = arg('house-script', ''), model = arg('model', 'sonnet'), briefName = arg('brief', 'default'), minutes = +arg('minutes', 5), basePort = +arg('port', 8900)
const root = fileURLToPath(new URL('../../', import.meta.url)), scratch = process.env.TMPDIR || '/tmp'
mkdirSync(out, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function one(seed, port) {
  const tag = `seed-${seed}`, server = spawn(process.execPath, [root + 'server.js'], {
    env: { ...process.env, PORT: String(port), BOTTERS_SEED: String(seed), BOTTERS_HOUSE_GAMBITS: JSON.stringify(SETS[setName]), ...(houseScript && { BOTTERS_HOUSE_SCRIPT: houseScript }) }, stdio: ['ignore', 'ignore', 'pipe'] })
  let serverLog = ''; server.stderr.on('data', d => { serverLog += d })
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${port}/rules`)).ok) break } catch {} await sleep(100) }
  const cfg = `${scratch}/botters-mcp-${port}.json`
  writeFileSync(cfg, JSON.stringify({ mcpServers: { botters: { command: process.execPath, args: [root + 'client.js'], env: { BOTTERS_SERVER: `http://localhost:${port}`, BOTTERS_OPEN: '0', BOTTERS_SETUP: `claude-code ${model}`, BOTTERS_NAME: 'agent' } } } }))
  const prompt = BRIEFS[briefName]({ minutes })
  const t0 = Date.now(), stream = createWriteStream(`${out}/${tag}.stream.jsonl`)
  const claude = spawn('claude', ['-p', prompt, '--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__botters__*', '--tools', '', '--setting-sources', 'project',
    '--output-format', 'stream-json', '--verbose', '--model', model, '--no-session-persistence', '--max-budget-usd', '4'], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] })
  let buf = '', result = null, edits = [], calls = { wait: 0, state: 0, set: 0, toggle: 0, breed: 0, call_human: 0, join: 0 }, lastToolAt = 0
  claude.stdout.on('data', d => {
    stream.write(d); buf += d
    for (let nl; (nl = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      let e; try { e = JSON.parse(line) } catch { continue }
      if (e.type === 'result') result = e
      if (e.type === 'assistant') for (const c of e.message?.content || []) if (c.type === 'tool_use') {
        lastToolAt = Date.now() - t0
        const n = c.name.replace('mcp__botters__', '')
        if (n === 'wait_for_event') calls.wait++; else if (n === 'get_state') calls.state++; else if (n === 'join_match') calls.join++; else if (n === 'call_human') calls.call_human++
        else if (n === 'set_gambits') { calls.set++; edits.push({ at: Math.round((Date.now() - t0) / 1000), why: c.input.why, gambits: c.input.gambits }) }
        else if (n === 'set_breed') { calls.breed++; edits.push({ at: Math.round((Date.now() - t0) / 1000), why: c.input.why, breed: c.input.breed }) }
        else if (n === 'toggle_gambit') { calls.toggle++; edits.push({ at: Math.round((Date.now() - t0) / 1000), why: c.input.why, toggle: c.input.index }) }
      }
    }
  })
  claude.stderr.on('data', () => {})
  const timer = setTimeout(() => claude.kill('SIGTERM'), (minutes * 60 + 180) * 1000)
  await new Promise(r => claude.on('close', r)); clearTimeout(timer); stream.end()
  // the match may still be running if the agent stopped early: let the server finish it (the gambits keep playing)
  for (let i = 0; i < (minutes * 60 + 60) && !/"reason"/.test(serverLog); i++) await sleep(1000)
  server.kill('SIGTERM')
  const end = serverLog.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)).at(-1) || null
  writeFileSync(`${out}/${tag}.server.json`, JSON.stringify(end))
  const row = { seed, set: setName, houseScript: houseScript || null, model, brief: briefName, winner: end ? (end.winner === 0 ? 'agent' : end.winner === 1 ? 'house' : 'draw') : 'no result', reason: end?.reason, at: end?.at,
    planets: end?.report?.planets, units: [end?.report?.you, end?.report?.enemy], edits: edits.length, calls, agentStoppedAt: Math.round(lastToolAt / 1000), wall: Math.round((Date.now() - t0) / 1000),
    cost: result?.total_cost_usd ?? null, turns: result?.num_turns ?? null, stop: result?.subtype ?? 'killed', editLog: edits }
  writeFileSync(`${out}/${tag}.json`, JSON.stringify(row, null, 1))
  console.log(JSON.stringify({ ...row, editLog: undefined }))
  return row
}

const queue = seeds.slice(), rows = []
await Promise.all(Array.from({ length: Math.min(parallel, seeds.length) }, async (_, k) => {
  for (let seed; (seed = queue.shift()) !== undefined;) { rows.push(await one(seed, basePort + k)); }
}))
writeFileSync(`${out}/summary.json`, JSON.stringify(rows.sort((a, b) => a.seed - b.seed).map(r => ({ ...r, editLog: undefined })), null, 1))
const w = rows.filter(r => r.winner === 'agent').length, cost = rows.reduce((a, r) => a + (r.cost || 0), 0)
console.log(`agent ${w}/${rows.length} wins · cost $${cost.toFixed(2)} · edits median ${rows.map(r => r.edits).sort((a, b) => a - b)[rows.length >> 1]}`)
