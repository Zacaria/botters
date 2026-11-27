import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { writeFileSync } from 'node:fs'
import { ROUNDS } from '../../sim.js'
import { POLICIES, playRoundsMatch } from './rounds.mjs'

if (!isMainThread) parentPort.on('message', ({ i, seed, policy }) => {
  try { if (process.env.ROUNDS_TUNE) Object.assign(ROUNDS, JSON.parse(process.env.ROUNDS_TUNE)); parentPort.postMessage({ i, result: playRoundsMatch({ seed, policy: POLICIES[policy] }) }) }
  catch (e) { parentPort.postMessage({ i, error: String(e.stack || e) }) }
})
else {
  const [from, to, names, out, threadArg] = process.argv.slice(2)
  const policies = (names || '').split(',')
  if (!Number.isInteger(+from) || !Number.isInteger(+to) || +from > +to || policies.some(p => !POLICIES[p])) throw new Error('usage: rounds-control.mjs <from> <to> <policy,policy> [out.json] [threads]')
  const threads = threadArg === undefined ? Math.max(1, availableParallelism() - 1) : Number(threadArg)
  if (!Number.isInteger(threads) || threads < 1) throw new Error('threads must be positive')
  const jobs = policies.flatMap(policy => Array.from({ length: +to - +from + 1 }, (_, i) => ({ policy, seed: +from + i })))
  const results = new Array(jobs.length); let next = 0
  await Promise.all(Array.from({ length: Math.min(threads, jobs.length) }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url))
    const feed = () => { if (next === jobs.length) { worker.terminate(); resolve(); return } const i = next++; worker.postMessage({ i, ...jobs[i] }) }
    worker.on('message', ({ i, result, error }) => { if (error) { worker.terminate(); reject(new Error(error)); return } results[i] = { policy: jobs[i].policy, ...result }; feed() })
    worker.on('error', reject); feed()
  })))
  if (out) writeFileSync(out, JSON.stringify(results, null, 2))
  for (const policy of policies) {
    const rows = results.filter(r => r.policy === policy), roundsWon = rows.reduce((n, r) => n + r.score[0], 0)
    console.log(JSON.stringify({ policy, house: 'variable (rounds.mjs house)', matchWins: rows.filter(r => r.winner === 0).length, draws: rows.filter(r => r.winner === null).length, losses: rows.filter(r => r.winner === 1).length, roundsWon, roundsPlayed: rows.reduce((n, r) => n + r.rounds.length, 0), perSeed: rows.map(r => r.winner === 0 ? 'W' : r.winner === 1 ? 'L' : '=').join('') }))
  }
}
