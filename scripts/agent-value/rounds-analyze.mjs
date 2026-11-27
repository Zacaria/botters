import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PREDATOR } from './rounds.mjs'

const choices = ['own last', 'predator of own last', 'prey of own last', 'opponent last', 'predator of opponent last', 'prey of opponent last']
const pick = (d, i) => { let b = i < 3 ? d.ownLast : d.opponentLast; for (let n = 0; n < i % 3; n++) b = PREDATOR[b]; return b }
export const ruleSet = choices.flatMap((won, x) => choices.map((lost, y) => ({ name: `after win/draw: ${won}; after loss: ${lost}`, won: x, lost: y })))
export const counterRate = rounds => rounds.length ? rounds.filter(r => r.own === PREDATOR[r.opponent]).length / rounds.length : null
export function bestRule(data) {
  if (!data.length) return { name: null, rate: null }
  return ruleSet.map(r => ({ name: r.name, rate: data.filter(d => pick(d, d.wonOrDrawn ? r.won : r.lost) === d.target).length / data.length })).reduce((a, b) => b.rate > a.rate ? b : a)
}
function analyze(dir) {
  const entries = ['A', 'B'].map(() => ({ matches: { won: 0, drawn: 0, lost: 0 }, rounds: { won: 0, played: 0 }, opening: {}, first: [], later: [], observations: [] }))
  for (const file of readdirSync(dir).filter(f => /^seed-.*\.log\.json$/.test(f)).sort()) {
    const log = JSON.parse(readFileSync(join(dir, file))), row = JSON.parse(readFileSync(join(dir, file.replace(/\.log\.json$/, '.json'))))
    if (!log.finishedAt || row.winnerSide === 'no result') continue
    for (let e = 0; e < 2; e++) {
      const s = row.entryOnSide0 === (e ? 'B' : 'A') ? 0 : 1, a = entries[e], rounds = log.pauses.filter(p => p.result)
      a.matches[log.winner === null ? 'drawn' : log.winner === s ? 'won' : 'lost']++
      for (let i = 0; i < rounds.length; i++) {
        const p = rounds[i], own = p.locked[s].breed, opponent = p.locked[1 - s].breed
        a.rounds.played++; if (p.result.winner === s) a.rounds.won++
        if (i === 0) { a.first.push({ own, opponent }); a.opening[own] = (a.opening[own] || 0) + 1 }
        else if (i < 5) { const last = rounds[i - 1]; a.later.push({ own, opponent }); a.observations.push({ ownLast: last.locked[s].breed, opponentLast: last.locked[1 - s].breed, wonOrDrawn: last.result.winner === null || last.result.winner === s, target: own }) }
      }
    }
  }
  let rng = 0x145f10; const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296 }
  return Object.fromEntries(entries.map((a, i) => {
    const best = bestRule(a.observations), baseline = a.observations.length ? Array.from({ length: 200 }, () => bestRule(a.observations.map(d => ({ ...d, target: ['runner', 'grunt', 'tank'][Math.floor(random() * 3)] }))).rate).reduce((x, y) => x + y, 0) / 200 : null
    return [i ? 'B' : 'A', { matches: a.matches, rounds: a.rounds, counterRate: { round1: counterRate(a.first), rounds2to5: counterRate(a.later) }, predictability: { ...best, nullBaseline: baseline }, round1BreedDistribution: a.opening }]
  }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), i = args.indexOf('--json'), output = i < 0 ? null : args.splice(i, 2)[1]
  if (!args.length || (i >= 0 && !output)) throw new Error('usage: rounds-analyze.mjs <dir> [<dir>...] [--json <file>]')
  const result = Object.fromEntries(args.map(dir => [dir, analyze(dir)])), json = JSON.stringify(result, null, 2)
  console.log(json); if (output) writeFileSync(output, json + '\n')
}
