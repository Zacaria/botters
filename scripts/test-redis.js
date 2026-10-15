// Optional integration check against an actual local Redis executable (not a mock).
// Example: REDIS_SERVER=.cache/redis/usr/bin/redis-server REDIS_CLI=.cache/redis/usr/bin/redis-cli node scripts/test-redis.js
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { RedisStore } from '../online/store.js'
import { OnlineGame } from '../online/game.js'
const exec = promisify(execFile), temp = await mkdtemp(join(tmpdir(), 'botters-redis-')), socket = join(temp, 'redis.sock')
const child = spawn(resolve(process.env.REDIS_SERVER || 'redis-server'), ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], { stdio: ['ignore', 'pipe', 'pipe'] })
let bridge
try {
  await new Promise((ok, no) => { child.on('error', no); child.on('exit', code => no(new Error(`Redis exited: ${code}`))); child.stdout.on('data', c => { if (c.toString().includes('ready to accept connections') || c.toString().includes('Ready to accept connections')) ok() }); child.stderr.on('data', c => process.stderr.write(c)); setTimeout(() => no(new Error('Redis startup timed out')), 5000).unref() })
  bridge = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk
      const args = JSON.parse(raw).map(String)
      const { stdout } = await exec(resolve(process.env.REDIS_CLI || 'redis-cli'), ['-s', socket, '--json', ...args], { maxBuffer: 4 * 1024 * 1024 })
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result: JSON.parse(stdout) }))
    } catch { res.writeHead(503); res.end('{}') }
  })
  await new Promise(r => bridge.listen(0, '127.0.0.1', r))
  const env = { UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${bridge.address().port}`, UPSTASH_REDIS_REST_TOKEN: 'local-test-only', BOTTERS_NAMESPACE: 'integration-test' }
  let now = Date.now()
  const store = new RedisStore(env), game = new OnlineGame(store, { now: () => now })
  const call = (s, method, path, body = {}, role = 'human') => game.request(method, path, new URLSearchParams({ token: s[`${role}Token`] }), body)
  const sessions = await Promise.all(['a', 'b'].map(name => game.request('POST', '/session', undefined, { name, setup: 'redis-check' })))
  await Promise.all(sessions.map(s => call(s, 'POST', '/play', { vs: 'player', minutes: 3, planning: 10 })))
  const frames = await Promise.all(sessions.map(s => call(s, 'GET', '/state')))
  assert.equal(frames[0].matchId, frames[1].matchId)
  const inputs = await Promise.allSettled(Array.from({ length: 8 }, () => call(sessions[0], 'POST', '/input', { gambits: [{ if: 'always', then: 'hold' }] }, 'agent')))
  assert.equal(inputs.filter(r => r.status === 'fulfilled').length, 5)
  assert.equal(inputs.filter(r => r.reason?.status === 429).length, 3)
  now += 200000
  await Promise.all(sessions.map(s => call(s, 'GET', '/state')))
  const lobby = await call(sessions[0], 'GET', '/lobby')
  assert.equal(lobby.history.length, 1); assert.equal(lobby.leaderboard.length, 2)
  const cold = new OnlineGame(new RedisStore(env), { now: () => now })
  const resumed = await cold.request('GET', '/state', new URLSearchParams({ token: sessions[0].humanToken }))
  assert.ok(resumed.view.ended && resumed.report)
  console.log('PASS: real Redis Lua CAS, concurrent matchmaking, shared 5/s rate limit, exactly-once Elo/history, new-instance resume. REST bridge uses redis-cli; not Upstash network latency.')
} finally {
  bridge?.closeAllConnections(); await new Promise(r => bridge ? bridge.close(r) : r())
  child.kill('SIGTERM'); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)); await rm(temp, { recursive: true })
}
