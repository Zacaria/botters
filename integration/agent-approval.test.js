import { test, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { convexTest } from 'convex-test'
import schema from '../convex/schema.js'
import { internal } from '../convex/_generated/api.js'
import { ConvexStore } from '../online/store.js'
import { OnlineGame } from '../online/game.js'
const modules = import.meta.glob('../convex/**/*.js')
const hash = s => createHash('sha256').update(s).digest('hex')

test('actual backend approval polling is one read-only snapshot and immediately observes revocation and expiry', async () => {
  const t = convexTest(schema, modules), calls = []
  const store = new ConvexStore({ BOTTERS_NAMESPACE: 'approval-test' })
  store.call = async (kind, path, args) => {
    calls.push({ kind, path, args })
    return t[kind](internal.store[path.split(':')[1]], args)
  }
  const game = new OnlineGame(store, { requireAccount: true })
  const poll = bearer => game.request('GET', '/agent/poll', new URLSearchParams({ token: bearer }))
  const bearer = 'a'.repeat(32), tokenKey = 'token:' + hash(bearer), pendingKey = 'pending:' + hash(bearer)
  const write = async (key, value, expiresAt = 0) => t.run(async ctx => {
    key = store.prefix + key
    const row = await ctx.db.query('records').withIndex('by_key', q => q.eq('key', key)).unique()
    const entry = { key, value: JSON.stringify(value), expiresAt }
    if (row) await ctx.db.replace(row._id, entry)
    else await ctx.db.insert('records', entry)
  })
  const oneRead = () => {
    expect(calls).toHaveLength(1)
    expect(calls[0].kind).toBe('query')
    expect(calls[0].path).toBe('store:get')
    expect(calls[0].args.followToken).toBe(true)
    calls.length = 0
  }
  await write(pendingKey, { id: 'pair', expires: Date.now() + 600000 })
  expect(await poll(bearer)).toEqual({ approved: false }); oneRead()
  const owner = { id: 'owner', accountId: 'verified-owner', agentVersion: 2, match: 'private-match' }
  const grant = { id: owner.id, role: 'agent', version: 2, expires: Date.now() + 600000 }
  await write('session:' + owner.id, owner)
  await write(tokenKey, grant)
  expect(await poll(bearer)).toEqual({ approved: true }); oneRead()
  // Follow only capability authority, never the private match or its simulation state.
  const snapshot = await t.query(internal.store.get, { keys: [store.prefix + tokenKey], now: Date.now(), followToken: true })
  expect(snapshot.keys).toEqual([store.prefix + tokenKey, store.prefix + 'session:' + owner.id])
  await write('session:' + owner.id, { ...owner, agentVersion: 3 })
  await expect(poll(bearer)).rejects.toMatchObject({ status: 401 }); oneRead()
  await write('session:' + owner.id, owner, Date.now() - 1)
  await expect(poll(bearer)).rejects.toMatchObject({ status: 401 }); oneRead()
  await write('session:' + owner.id, owner)
  await write(tokenKey, { ...grant, expires: Date.now() - 1 })
  await expect(poll(bearer)).rejects.toMatchObject({ status: 401 }); oneRead()
  await write(tokenKey, grant, Date.now() - 1)
  await write(pendingKey, { expires: Date.now() - 1 })
  await expect(poll(bearer)).rejects.toMatchObject({ status: 410 }); oneRead()
  await expect(poll('bad')).rejects.toMatchObject({ status: 401 })
  expect(calls).toHaveLength(0)
  // A scoped HTTP invocation must not reuse an earlier approval result.
  const scoped = store.scoped(), scopedGame = new OnlineGame(scoped, { requireAccount: true })
  await write(tokenKey, grant)
  expect(await scopedGame.request('GET', '/agent/poll', new URLSearchParams({ token: bearer }))).toEqual({ approved: true }); oneRead()
  await write('session:' + owner.id, { ...owner, agentVersion: 3 })
  await expect(scopedGame.request('GET', '/agent/poll', new URLSearchParams({ token: bearer }))).rejects.toMatchObject({ status: 401 }); oneRead()
  store.call = async () => { throw Object.assign(new Error('Unavailable'), { status: 503 }) }
  await expect(poll(bearer)).rejects.toMatchObject({ status: 503 })
})
