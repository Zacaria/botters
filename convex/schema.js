import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  records: defineTable({ key: v.string(), value: v.string(), expiresAt: v.number() })
    .index('by_key', ['key'])
    .index('by_expiry', ['expiresAt']),
})
