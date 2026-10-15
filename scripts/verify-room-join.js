// Targeted HTTP + durable readback regression; creates only its own disposable sessions/rooms.
// BOTTERS_SERVER, BOTTERS_NAMESPACE and server-only Convex env are required. Never prints capabilities.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { ConvexStore } from '../online/store.js'

const base = process.env.BOTTERS_SERVER, namespace = process.env.BOTTERS_NAMESPACE
assert.ok(base && ['preview', 'production'].includes(namespace), 'Set BOTTERS_SERVER and BOTTERS_NAMESPACE explicitly.')
const store = new ConvexStore(), checks = []
const headers = { 'Content-Type': 'application/json' }
if (new URL(base).hostname.endsWith('.vercel.app') && process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
async function call(session, method, path, body, status = 200) {
  const res = await fetch(new URL(path + (session ? `?token=${session.humanToken}` : ''), base), {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  })
  assert.equal(res.status, status, `${method} ${path}: unexpected status`)
  return res.json()
}
const session = name => call(null, 'POST', '/session', { name })
const [host, guest, replacement] = await Promise.all(['Join check host', 'Join check rejected', 'Join check replacement'].map(session))
const room = await call(host, 'POST', '/rooms', { minutes: 3, planets: 16, planning: 10 })
try {
  await call(guest, 'POST', '/rooms', { withAgent: false, opening: [{ if: 'always', then: 'hold' }] })
  await call(guest, 'POST', '/rooms/leave', {})
  const auth = JSON.parse(await store.get('token:' + createHash('sha256').update(guest.humanToken).digest('hex')))
  assert.ok(auth?.id)
  const guestKey = `session:${auth.id}`
  const beforeGuest = JSON.parse(await store.get(guestKey))
  const beforeRoom = JSON.parse(await store.get('index')).rooms[room.code]
  assert.equal(beforeGuest.room, null)
  const rejected = await call(guest, 'POST', '/rooms/join', { code: room.code, opening: [{ if: 'always', then: 'hold', p: 100001 }] }, 400)
  assert.ok(rejected.error)
  const afterRoom = JSON.parse(await store.get('index')).rooms[room.code]
  const afterGuest = JSON.parse(await store.get(guestKey))
  assert.deepEqual(afterRoom, beforeRoom)
  assert.equal(afterGuest.room, beforeGuest.room)
  assert.deepEqual(afterGuest.roomPrefs, beforeGuest.roomPrefs)
  checks.push('400 preserves durable membership/readiness/timestamp and guest room/preferences')
  assert.equal((await call(host, 'GET', '/room')).players.length, 1)
  assert.equal((await call(guest, 'GET', '/lobby')).room, null)
  checks.push('host and rejected guest HTTP views remain unchanged')
  const joined = await call(replacement, 'POST', '/rooms/join', { code: room.code })
  assert.equal(joined.players.length, 2)
  assert.deepEqual(joined.players.map(p => p.name), ['Join check host', 'Join check replacement'])
  assert.equal((await call(host, 'GET', '/room')).players.length, 2)
  checks.push('different valid guest joins successfully; host sees both players')
} finally {
  // Normal leave actions affect only these fixture sessions, not unrelated data.
  await call(replacement, 'POST', '/rooms/leave', {})
  await call(host, 'POST', '/rooms/leave', {})
}
console.log(JSON.stringify({
  verifiedAt: new Date().toISOString(), result: 'PASS', url: base, namespace,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  checks, cleanup: 'Both fixture room members left normally; sessions expire by TTL. No match started.',
  limits: 'Targeted room-join check, not a repeated full cloud gameplay/capacity or two-machine suite.',
}, null, 2))
