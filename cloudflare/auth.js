import { betterAuth } from 'better-auth'
import { authOptions } from '../online/auth-options.js'
import { removeGameAccount } from './account-cleanup.js'
import { D1Store } from './d1-store.js'
import { hash } from './authority.js'
import { transaction } from '../online/store.js'

export async function deliver(env, message) {
  const from = env.AUTH_EMAIL_FROM
  if (!env.EMAIL || typeof env.EMAIL.send !== 'function' || from !== 'botters@mail.havesomecode.io' || /[\r\n]/.test(message.to + message.subject)) throw new Error('Email delivery is not configured.')
  let timer
  try {
    const response = await Promise.race([
      env.EMAIL.send({ from, to: message.to, subject: message.subject, text: message.text }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Email timeout')), 8000) }),
    ])
    if (!response || typeof response.messageId !== 'string' || !response.messageId.trim()) throw new Error()
    // This proves binding acceptance only, not delivery or inbox receipt.
    return { messageId: response.messageId }
  } catch { throw new Error('Email delivery is unavailable.') }
  finally { clearTimeout(timer) }
}
// Anyone can ask for these emails: one address gets at most 3 of each kind per ten minutes and 6 per hour.
// Links last an hour, so a refused request means a usable link of that kind is already in the inbox.
// The counter follows the exact address: a look-alike address is another account and must not use up this one's allowance.
const mailbox = to => String(to).trim().toLowerCase()
export async function deliverLimited(env, message, store = new D1Store(env.DB), now = Date.now()) {
  const allowed = await transaction(store, async tx => {
    const r = await tx.get(`mail:${hash(`${env.BETTER_AUTH_SECRET}|${message.subject}|${mailbox(message.to)}`)}`, { sent: [] }, 3600)
    r.sent = r.sent.filter(t => now - t < 3600000)
    if (r.sent.length >= 6 || r.sent.filter(t => now - t < 600000).length >= 3) return false
    r.sent.push(now); return true
  })
  return allowed ? deliver(env, message) : { skipped: true }
}
export function createAuth(env) {
  const options = authOptions(env, m => deliverLimited(env, m))
  return betterAuth({ ...options, database: env.DB, user: { deleteUser: { enabled: true } },
    databaseHooks: { user: { delete: { after: user => removeGameAccount(env.DB, user.id) } } },
    emailAndPassword: { ...options.emailAndPassword,
      onPasswordReset: async ({ user }) => {
        await env.DB.prepare(`UPDATE game_records SET value=json_set(value,'$.agentVersion',coalesce(json_extract(value,'$.agentVersion'),0)+1,'$.agentGranted',0) WHERE key LIKE 'session:%' AND json_extract(value,'$.accountId')=?`).bind(user.id).run()
      },
    },
  })
}
export async function identity(auth, request) {
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } })
  if (!session?.user.emailVerified || +new Date(session.session.expiresAt) <= Date.now()) return null
  return { id: session.user.id, name: session.user.name, emailVerified: true, authSessionId: session.session.id, authExpires: +new Date(session.session.expiresAt) }
}
