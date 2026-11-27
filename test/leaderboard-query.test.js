import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { boardQuery } from '../cloudflare/d1-store.js'

test('leaderboard reads use the key index and select only their namespace', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync('cloudflare/migrations/0001_initial.sql','utf8'))
    const insert = db.prepare('INSERT INTO game_records(key,value,expires) VALUES(?,?,?)')
    for (let i = 0; i < 2000; i++) insert.run(`${i % 2 ? 'match' : 'session'}:${i}`,'{}',i % 2 ? 0 : Date.now()+60000)
    for (const key of ['verified:elo:one','verified:elo:two','verified:elo:three','elo:one']) insert.run(key,'{}',0)
    const plan = db.prepare('EXPLAIN QUERY PLAN '+boardQuery).all('verified:elo:','verified:elo;',Date.now()).map(row=>row.detail).join(' ')
    assert.match(plan,/SEARCH.*(?:key|sqlite_autoindex_game_records_1)/i)
    assert.doesNotMatch(plan,/SCAN|game_records_expiry/i)
    assert.equal(db.prepare(boardQuery).all('verified:elo:','verified:elo;',Date.now()).length,3)
    assert.equal(db.prepare(boardQuery).all('elo:','elo;',Date.now()).length,1)
  } finally { db.close() }
})
