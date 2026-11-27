// Paid benchmark driver. Running model sides invokes Claude Code; it is not run on import.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, createWriteStream, existsSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { ROUNDS } from '../../sim.js'
import { POLICIES } from './rounds.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const seeds = arg('seeds', '1').split(',').map(Number), entries = arg('sides', 'haiku,house').split(','), out = resolve(arg('out', 'rounds-run')), parallel = Number(arg('parallel', 4)), swap = process.argv.includes('--swap')
const root = fileURLToPath(new URL('../../', import.meta.url)), scratch = process.env.TMPDIR || '/tmp'
if (!seeds.length || seeds.some(s => !Number.isInteger(s)) || new Set(seeds).size !== seeds.length || entries.length !== 2 || entries.some(s => !s || s === 'agent') || !Number.isInteger(parallel) || parallel < 1) throw new Error('invalid seeds, sides or parallel')
mkdirSync(out, { recursive: true })
const queue = seeds.flatMap(seed => [{ seed, tag: `seed-${seed}-a`, sides: entries.slice(), entryOnSide0: 'A' }, ...(swap ? [{ seed, tag: `seed-${seed}-b`, sides: entries.slice().reverse(), entryOnSide0: 'B' }] : [])])
for (const q of queue) if (existsSync(join(out, `${q.tag}.log.json`))) throw new Error(`refusing to reuse existing match log: ${q.tag}`)
const isPolicy = name => name === 'house' || Object.hasOwn(POLICIES, name)
const prompt = "Let's play Botters in rounds. You build my bot between rounds; you never act during a round. Call wait_for_pause, write the bot with set_bot before the gong, and repeat until wait_for_pause says the match is over, then stop. Try to win the match."
const delay = ms => new Promise(r => setTimeout(r, ms))
function watch(child) { return new Promise(resolve => { let error = null; child.on('error', e => { error = e.message }); child.on('close', (code, signal) => resolve({ code, signal, error })) }) }
async function one(q) {
  const { seed, tag, sides, entryOnSide0 } = q, log = join(out, `${tag}.log.json`), temp = mkdtempSync(join(scratch, 'br-')), socket = join(temp, 's'), start = Date.now(), children = []
  const host = spawn(process.execPath, [join(root, 'scripts/agent-value/rounds-host.mjs'), '--seed', String(seed), '--sides', sides.map(s => isPolicy(s) ? s : 'agent').join(','), '--log', log, '--socket', socket], { stdio: ['ignore', 'ignore', 'inherit'] })
  children.push(host); let hostDone = false; const hostExit = watch(host).then(r => { hostDone = true; return r })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; for (const c of children) c.kill('SIGTERM'); setTimeout(() => { for (const c of children) c.kill('SIGKILL') }, 5000).unref() }, (ROUNDS.count * (ROUNDS.pause + 60) + 300) * 1000)
  const agentResults = [null, null]
  try {
    while (!existsSync(socket) && !hostDone && !timedOut) await delay(50)
    if (!existsSync(socket)) throw new Error(`host failed to start for ${tag}`)
    await Promise.all(sides.map(async (name, side) => {
      if (isPolicy(name)) return
      const cfg = join(temp, `side${side}.json`), calls = { wait_for_pause: 0, set_bot: 0 }
      writeFileSync(cfg, JSON.stringify({ mcpServers: { botters: { command: process.execPath, args: [join(root, 'scripts/agent-value/rounds-mcp.mjs')], env: { ROUNDS_HOST: socket, ROUNDS_SIDE: String(side) } } } }))
      const child = spawn('claude', ['-p', prompt, '--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__botters__*', '--tools', '', '--setting-sources', 'project', '--output-format', 'stream-json', '--verbose', '--model', name, '--no-session-persistence', '--max-budget-usd', '1.5'], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] })
      children.push(child); const exited = watch(child); child.stderr.resume()
      let buffer = '', result = null
      child.stdout.on('data', chunk => { buffer += chunk; for (let nl; (nl = buffer.indexOf('\n')) >= 0;) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); let e; try { e = JSON.parse(line) } catch { continue } if (e.type === 'result') result = e; if (e.type === 'assistant') for (const c of e.message?.content || []) if (c.type === 'tool_use') { const n = c.name.replace('mcp__botters__', ''); if (Object.hasOwn(calls, n)) calls[n]++ } } })
      const compressed = pipeline(child.stdout, createGzip(), createWriteStream(join(out, `${tag}.side${side}.stream.jsonl.gz`)))
      const status = await exited; await compressed
      agentResults[side] = { cost: result?.total_cost_usd ?? null, turns: result?.num_turns ?? null, stop: status.error || (timedOut ? 'timeout' : result?.subtype ?? 'no result'), calls }
    }))
    await hostExit
  } finally { clearTimeout(timer); if (!hostDone) { host.kill('SIGTERM'); await hostExit } rmSync(temp, { recursive: true, force: true }) }
  let match = null; try { match = JSON.parse(readFileSync(log, 'utf8')) } catch {}
  const pauses = match?.pauses ?? [], row = { seed, tag, sides, entryOnSide0, winnerSide: match?.finishedAt ? match.winner : 'no result', score: match?.score ?? null, rounds: pauses.filter(p => p.result).map(p => ({ breeds: p.locked.map(b => b.breed), winner: p.result.winner })), perSide: sides.map((name, side) => ({ name, cost: agentResults[side]?.cost ?? null, turns: agentResults[side]?.turns ?? null, stop: agentResults[side]?.stop ?? null, calls: agentResults[side]?.calls ?? null, versionsPerPause: isPolicy(name) ? null : pauses.map(p => p.sides[side].versions.length), invalid: isPolicy(name) ? null : pauses.reduce((n, p) => n + p.sides[side].invalid.length, 0), late: isPolicy(name) ? null : pauses.reduce((n, p) => n + p.sides[side].late.length, 0) })), wall: Math.round((Date.now() - start) / 1000) }
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(row, null, 2)); return row
}
const rows = []
await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => { for (let q; (q = queue.shift());) rows.push(await one(q)) }))
rows.sort((a, b) => a.seed - b.seed || a.tag.localeCompare(b.tag)); writeFileSync(join(out, 'summary.json'), JSON.stringify(rows, null, 2))
const wins = entry => rows.filter(r => r.winnerSide !== null && r.winnerSide !== 'no result' && (r.winnerSide === 0 ? r.entryOnSide0 : r.entryOnSide0 === 'A' ? 'B' : 'A') === entry).length
console.log(`A ${wins('A')} wins · B ${wins('B')} wins · draws ${rows.filter(r => r.winnerSide === null).length} · total cost $${rows.reduce((n, r) => n + r.perSide.reduce((s, p) => s + (p.cost ?? 0), 0), 0).toFixed(2)}`)
