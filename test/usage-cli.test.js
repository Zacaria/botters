import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { spawnSync } from 'node:child_process'

test('usage CLI reads D1 and prints counts without identifiers', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'botters-usage-'))
  t.after(() => rm(dir, {recursive: true, force: true}))
  const now = Date.now(), week = new Date(now), monday = Date.UTC(week.getUTCFullYear(), week.getUTCMonth(), week.getUTCDate() - (week.getUTCDay()+6)%7)
  const rows = [
    {kind:'user', id:'private-old', created:monday-86400000, verified:1},
    {kind:'user', id:'private-new', created:monday+1000, verified:1},
    {kind:'user', id:'private-unverified', created:monday+1000, verified:0},
    {kind:'session', id:'private-old', created:monday+1000, updated:monday+2000},
    {kind:'match', value:JSON.stringify({at:monday+1000, online:true, agent:true, accounts:['private-old','private-new']})},
  ]
  const executable = `#!/usr/bin/env node\nif (process.argv.slice(2,8).join(' ') !== 'wrangler d1 execute botters-play --remote --json' || process.argv[8] !== '--command') process.exit(2);\nconsole.log(${JSON.stringify(JSON.stringify([{results:rows}]))})\n`
  await writeFile(join(dir,'npx'), executable, {mode:0o755})
  const result = spawnSync(process.execPath, ['scripts/usage.js'], {encoding:'utf8', env:{...process.env, PATH:dir+delimiter+process.env.PATH}})
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'no stderr')
  assert.match(result.stdout, new RegExp(`${new Date(monday).toISOString().slice(0,10)}\\s*\\|\\s*1\\s*\\|\\s*1\\s*\\|\\s*1\\s*\\|\\s*0\\s*\\|\\s*1`))
  assert.doesNotMatch(result.stdout + result.stderr, /private-/)
  assert.match(result.stdout, /Match counts start/)
})
