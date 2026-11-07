// PostgreSQL identity pilot. This is not wired into the deployed control server.
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { authOptions } from './auth-options.js'

export async function createPostgresAuth({ pool, env, sendEmail }) {
  if (!pool || typeof sendEmail !== 'function') throw new Error('PostgreSQL and email delivery are required.')
  const options = { ...authOptions(env, sendEmail), database: pool }
  return { auth: betterAuth(options), migrate: async () => (await getMigrations(options)).runMigrations() }
}
