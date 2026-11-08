import http from 'node:http'
import pg from 'pg'
import { createPostgresControl } from '../api/index.js'
import { deliverAuthEmail } from '../online/auth-options.js'

const env = process.env
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 8000, statement_timeout: 8000 })
try {
  const handler = await createPostgresControl({ pool, env, sendEmail: message => deliverAuthEmail(env, message) })
  const server = http.createServer(handler)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(env.PORT || 8789), env.HOST || '127.0.0.1', resolve) })
  console.log(JSON.stringify({ service: 'botters-control', backend: 'postgres' }))
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    if (closing) return
    closing = true
    server.closeIdleConnections()
    await new Promise(resolve => server.close(resolve))
    await pool.end()
  })
} catch (error) { await pool.end(); throw error }
