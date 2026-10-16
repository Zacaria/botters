import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'

const alice = { id: 'verified-alice', name: 'Alice', emailVerified: true }
const bob = { id: 'verified-bob', name: 'Bob', emailVerified: true }
function harness() {
  let time = 1800000000000
  const store = new MemoryStore(() => time)
  const request = (identity, method, path, token = '', body = {}) => new OnlineGame(store, { now: () => time, origin: 'https://botters.havesomecode.io', requireAccount: true, identity }).request(method, path, new URLSearchParams({ token }), body)
  return { store, request, advance: ms => { time += ms } }
}
const denied = (promise, status = 401) => assert.rejects(promise, e => e.status === status)

test('online accounts reject anonymous/unverified/spoofed users and scope human tokens to a live owner', async () => {
  const { request } = harness()
  await denied(request(null, 'POST', '/session', '', { accountId: alice.id }))
  await denied(request({ ...alice, emailVerified: false }, 'POST', '/session'))
  const a = await request(alice, 'POST', '/session', '', { name: 'Alice' })
  assert.equal(a.agentToken, undefined, 'browser must explicitly approve agent delegation')
  await denied(request(null, 'GET', '/lobby', a.humanToken))
  await denied(request(bob, 'GET', '/lobby', a.humanToken))
  assert.equal((await request(alice, 'GET', '/lobby', a.humanToken)).name, 'Alice')
  const reconnect = await request(alice, 'POST', '/session')
  assert.equal(reconnect.sessionId, a.sessionId, 'account survives fresh browser capabilities')
  const b = await request(bob, 'POST', '/session', '', { name: 'Alice' })
  assert.notEqual(b.sessionId, a.sessionId, 'same display name never claims another account')
})

test('pairing requires explicit verified approval, rejects expiry, and grants revocable agent-only capabilities', async () => {
  const { request, advance } = harness()
  const a = await request(alice, 'POST', '/session')
  const pair = await request(null, 'POST', '/agent/pair', '', { setup: 'codex' })
  assert.ok(pair.approvalUrl.startsWith('https://botters.havesomecode.io/?pair='))
  assert.ok(!pair.approvalUrl.includes(pair.agentToken))
  assert.equal((await request(null, 'GET', '/agent/poll', pair.agentToken)).approved, false)
  await denied(request(null, 'GET', '/next', pair.agentToken))
  await denied(request(null, 'POST', '/agent/approve', a.humanToken, { id: pair.id }))
  await request(alice, 'POST', '/agent/approve', a.humanToken, { id: pair.id })
  assert.equal((await request(null, 'GET', '/agent/poll', pair.agentToken)).approved, true)
  await request(null, 'GET', '/next', pair.agentToken)
  for (const path of ['/lobby', '/profile', '/rooms', '/agent/revoke', '/agent/approve']) await denied(request(null, 'POST', path, pair.agentToken, {}))
  await request(alice, 'POST', '/agent/revoke', a.humanToken)
  await denied(request(null, 'GET', '/next', pair.agentToken))
  const expired = await request(null, 'POST', '/agent/pair')
  advance(600001)
  await denied(request(alice, 'POST', '/agent/approve', a.humanToken, { id: expired.id }), 410)
  await denied(request(null, 'GET', '/agent/poll', expired.agentToken), 410)
})

test('account history and room membership survive reconnect; self matchmaking and legacy token adoption are denied', async () => {
  const { request, store } = harness()
  const a = await request(alice, 'POST', '/session')
  await request(alice, 'POST', '/rooms', a.humanToken, {})
  const first = await request(alice, 'GET', '/lobby', a.humanToken)
  const again = await request(alice, 'POST', '/session')
  assert.equal((await request(alice, 'GET', '/lobby', again.humanToken)).room.code, first.room.code)
  const guest = await new OnlineGame(store).request('POST', '/session', new URLSearchParams(), { name: 'Alice' })
  await denied(request(alice, 'GET', '/lobby', guest.humanToken))
})

test('verified Elo keys survive renames, exclude the house and cannot be claimed by display-name collisions', async () => {
  const { request, advance } = harness()
  const a = await request(alice, 'POST', '/session'), b = await request(bob, 'POST', '/session')
  const opts = { vs: 'player', minutes: 3, planning: 10, withAgent: false }
  for (let i = 0; i < 2; i++) {
    if (i) await request(alice, 'POST', '/profile', a.humanToken, { name: 'Bob' })
    await request(alice, 'POST', '/play', a.humanToken, opts)
    await request(bob, 'POST', '/play', b.humanToken, opts)
    advance(191000)
    const end = await request(alice, 'GET', '/state', a.humanToken)
    assert.ok(end.report)
    const board = (await request(alice, 'GET', '/leaderboard')).leaderboard
    assert.equal(board.length, 2)
    assert.ok(board.every(r => r.games === i + 1))
  }
  const history = (await request(alice, 'GET', '/lobby', a.humanToken)).history
  assert.equal(history.length, 2)
  await request(alice, 'POST', '/play', a.humanToken, { ...opts, vs: 'easy' })
  advance(191000); await request(alice, 'GET', '/state', a.humanToken)
  const board = (await request(alice, 'GET', '/leaderboard')).leaderboard
  assert.equal(board.length, 2); assert.ok(board.every(r => r.games === 2))
})
