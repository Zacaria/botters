import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  records: defineTable({ key: v.string(), value: v.string(), expiresAt: v.number(), ratingNamespace: v.optional(v.string()), ratingRank: v.optional(v.number()), ratingIdentity: v.optional(v.string()) })
    .index('by_key', ['key'])
    .index('by_expiry', ['expiresAt'])
    .index('by_rating', ['ratingNamespace', 'ratingRank', 'ratingIdentity']),
})
