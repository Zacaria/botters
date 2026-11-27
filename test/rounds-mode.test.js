import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startRounds, setBot, ready, advance, publicMatch, house } from '../rounds.js'

test('rounds accept edits, refuse invalid bots and play five rounds', () => {
  const m = startRounds({seed: 123, breed:'tank', now: 0, seconds:2})
  assert.equal(publicMatch(m, 0).secondsLeft, 60)
  assert.equal(setBot(m, 'agent', {round:1, breed:'runner', gambits:[{if:'always',then:'hold'}], why:'test'}, 1).ok, true)
  assert.equal(publicMatch(m,1).versions[0].who, 'agent')
  assert.match(setBot(m, 'you', {round:1, gambits:[{if:'nope',then:'hold'}]}, 2).error, /Refused/)
  assert.equal(publicMatch(m,2).bot.breed, 'runner')
  assert.equal(ready(m,1,3).ok,true)
  let p = publicMatch(m,3)
  assert.equal(p.phase,'fight'); assert.ok(p.rounds[0].yourArmy); assert.ok(p.rounds[0].houseArmy)
  advance(m,403); p = publicMatch(m,403)
  assert.equal(p.phase,'pause'); assert.equal(p.round,2)
  assert.ok([4,5].includes(p.slots.you)); assert.ok([4,5].includes(p.slots.house))
  advance(m, 400000)
  p=publicMatch(m,400000); assert.equal(p.phase,'over'); assert.equal(p.rounds.length,5); assert.ok(p.score.you+p.score.house<=5)
})
test('house counters the breed that beat it', () => {
  assert.equal(house(2,4,[{bots:[{breed:'tank'},{breed:'grunt'}],result:{winner:0}}],1).breed,'runner')
})

test('the replay window opens once the round is computed', () => {
  const m = startRounds({seed: 7, breed:'grunt', now: 0, seconds:2})
  ready(m, 1, 10, () => 900) // the simulation finished 890 ms after the gong
  assert.equal(publicMatch(m, 900).fight.msLeft, 400)
})
