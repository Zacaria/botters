import { betterAuth } from 'better-auth/minimal'
import { createClient } from '@convex-dev/better-auth'
import { components } from './_generated/api.js'
import { authOptions, deliverAuthEmail } from '../online/auth-options.js'
const client = createClient(components.betterAuth)
export const createAuth = ctx => betterAuth({
  ...authOptions(process.env, message => deliverAuthEmail(process.env, message)),
  database: client.adapter(ctx),
})
