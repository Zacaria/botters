import { test, expect } from 'vitest'
import { convexTest } from 'convex-test'
import betterAuthTest from '@convex-dev/better-auth/test'
import schema from '../convex/schema.js'
import { internal, components } from '../convex/_generated/api.js'
const modules = import.meta.glob('../convex/**/*.js')

test('weekly usage buckets verified signups and distinct returning activity without identifiers', async () => {
  const t = convexTest(schema, modules); betterAuthTest.register(t)
  const week = Date.UTC(2026, 10, 16), day = 86400000, prefix = 'test:'
  const create = (model, data) => t.mutation(components.betterAuth.adapter.create, { input: { model, data } })
  const user = async (name, createdAt, emailVerified = true) => create('user', { name, email: `${name}@example.test`, emailVerified, createdAt, updatedAt: createdAt })
  const old = await user('old', week - 20 * day), newer = await user('new', week + day), unverified = await user('unverified', week - day, false)
  await create('session', { userId: old._id, token: 'secret', createdAt: week - day, updatedAt: week + day, expiresAt: week + 10 * day })
  await create('session', { userId: newer._id, token: 'secret2', createdAt: week + day, updatedAt: week + day, expiresAt: week + 10 * day })
  const records = [
    { at: week - day, online: false, agent: false, accounts: [old._id] },
    { at: week + day, online: true, agent: true, accounts: [old._id, newer._id] },
    { at: week + 2 * day, online: false, agent: false, accounts: [old._id, unverified._id] },
  ]
  await t.run(async ctx => { for (const [i, value] of records.entries()) await ctx.db.insert('records', { key: `${prefix}usage:${i}`, value: JSON.stringify(value), expiresAt: 0 }) })
  const result = await t.query(internal.usage.weekly, { prefix, weeks: 2, now: week + 3 * day })
  expect(result).toEqual({ weeks: [
    { start: week - 7 * day, signups: 0, online: 0, agent: 0, house: 1, returning: 1 },
    { start: week, signups: 1, online: 1, agent: 1, house: 1, returning: 2 },
  ], matchesSince: week - day })
  for (const id of [old._id, newer._id, unverified._id]) expect(JSON.stringify(result)).not.toContain(id)
})
