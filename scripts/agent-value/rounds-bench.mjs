// Paid benchmark driver. Running this invokes Claude Code; it is not run on import.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, createWriteStream, unlinkSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { ROUNDS } from '../../sim.js'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const seeds = arg('seeds', '1').split(',').map(Number), out = resolve(arg('out', 'rounds-run')), model = arg('model', 'haiku'), house = arg('house', 'blobflank'), parallel = Number(arg('parallel', 4))
const root = fileURLToPath(new URL('../../', import.meta.url)), scratch = process.env.TMPDIR || '/tmp'
if (!seeds.length || seeds.some(s => !Number.isInteger(s)) || new Set(seeds).size !== seeds.length || !Number.isInteger(parallel) || parallel < 1) throw new Error('invalid seeds or parallel')
mkdirSync(out, { recursive: true })
const prompt = "Let's play Botters in rounds. You build my bot between rounds; you never act during a round. Call wait_for_pause, write the bot with set_bot before the gong, and repeat until wait_for_pause says the match is over, then stop. Try to win the match."
async function one(seed) {
  const tag = `seed-${seed}`, log = join(out, `${tag}.log.json`), cfg = join(scratch, `botters-rounds-${process.pid}-${seed}.json`), plain = join(out, `${tag}.stream.jsonl`)
  if (existsSync(log)) throw new Error(`refusing to reuse existing match log: ${log}`)
  writeFileSync(cfg, JSON.stringify({ mcpServers: { botters: { command: process.execPath, args: [join(root, 'scripts/agent-value/rounds-mcp.mjs')], env: { ROUNDS_SEED: String(seed), ROUNDS_HOUSE: house, ROUNDS_LOG: log, ROUNDS_COUNT: String(ROUNDS.count), ROUNDS_SECONDS: String(ROUNDS.seconds), ROUNDS_PAUSE: String(ROUNDS.pause) } } } }))
  const start = Date.now(), stream = createWriteStream(plain), calls = { wait_for_pause: 0, set_bot: 0 }
  const child = spawn('claude', ['-p', prompt, '--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__botters__*', '--tools', '', '--setting-sources', 'project', '--output-format', 'stream-json', '--verbose', '--model', model, '--no-session-persistence', '--max-budget-usd', '1.5'], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = '', result = null, spawnError = null, timedOut = false
  child.on('error', e => { spawnError = e.message })
  child.stderr.on('data', () => {})
  child.stdout.on('data', chunk => {
    stream.write(chunk); buffer += chunk
    for (let nl; (nl = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1)
      let e; try { e = JSON.parse(line) } catch { continue }
      if (e.type === 'result') result = e
      if (e.type === 'assistant') for (const c of e.message?.content || []) if (c.type === 'tool_use') { const name = c.name.replace('mcp__botters__', ''); if (Object.hasOwn(calls, name)) calls[name]++ }
    }
  })
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, (ROUNDS.count * (ROUNDS.pause + 60) + 180) * 1000)
  await new Promise(r => child.on('close', r)); clearTimeout(timer)
  await new Promise((resolveStream, reject) => { stream.on('error', reject); stream.end(resolveStream) })
  const { createReadStream } = await import('node:fs')
  await pipeline(createReadStream(plain), createGzip(), createWriteStream(`${plain}.gz`)); unlinkSync(plain); unlinkSync(cfg)
  let match = null; try { match = JSON.parse(readFileSync(log, 'utf8')) } catch {}
  const pauses = match?.pauses ?? [], row = { seed, model, house, winner: match?.finishedAt ? (match.winner === 0 ? 'agent' : match.winner === 1 ? 'house' : 'draw') : 'no result', score: match?.score ?? null, roundResults: pauses.filter(p => p.result).map(p => p.result.winner === null ? 'draw' : p.result.winner === 0 ? 'won' : 'lost'), versionsPerPause: pauses.map(p => p.versions.length), late: pauses.reduce((n, p) => n + p.late.length, 0), invalid: pauses.reduce((n, p) => n + p.invalid.length, 0), pausesWithoutVersion: pauses.filter(p => !p.versions.length).length, cost: result?.total_cost_usd ?? null, turns: result?.num_turns ?? null, wall: Math.round((Date.now() - start) / 1000), stop: spawnError || (timedOut ? 'timeout' : result?.subtype ?? 'no result'), calls }
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(row, null, 2)); return row
}
const queue = seeds.slice(), rows = []
await Promise.all(Array.from({ length: Math.min(parallel, seeds.length) }, async () => { for (let seed; (seed = queue.shift()) !== undefined;) rows.push(await one(seed)) }))
rows.sort((a, b) => a.seed - b.seed); writeFileSync(join(out, 'summary.json'), JSON.stringify(rows, null, 2))
const versions = rows.flatMap(r => r.versionsPerPause).sort((a, b) => a - b), mid = versions.length >> 1, median = versions.length ? (versions.length % 2 ? versions[mid] : (versions[mid - 1] + versions[mid]) / 2) : 0
console.log(`agent ${rows.filter(r => r.winner === 'agent').length}/${rows.length} match wins · rounds won ${rows.reduce((n, r) => n + r.roundResults.filter(x => x === 'won').length, 0)}/${rows.reduce((n, r) => n + r.roundResults.length, 0)} · versions per pause median ${median} · late ${rows.reduce((n, r) => n + r.late, 0)} · cost $${rows.reduce((n, r) => n + (r.cost || 0), 0).toFixed(2)}`)
