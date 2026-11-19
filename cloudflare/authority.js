import { createHash, randomBytes } from 'node:crypto'
import { transaction } from '../online/store.js'
export const hash = s => createHash('sha256').update(s).digest('hex')
export const nonce = () => randomBytes(24).toString('base64url')
export const denied = () => Object.assign(new Error('Access ended. Sign in or reconnect your agent.'), { status: 401 })
export const cookieName = env => env.SITE_URL.startsWith('https:') ? '__Host-botters-live' : 'botters-live'
export function proof(req, env) {
  const value = req.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(cookieName(env) + '='))?.slice(cookieName(env).length + 1)
  return value && /^[A-Za-z0-9_-]{32}$/.test(value) ? hash(value) : null
}
// No shared session/bookmark: every admission starts on the current primary.
export async function authorize(env, key, cookieHash = null) {
  if (!/^token:[a-f0-9]{64}$/.test(key)) throw denied()
  const now = Date.now()
  const row = await env.DB.prepare(`SELECT t.value AS token,o.value AS owner,s."expiresAt" AS authExpiry,u.id AS userId
    FROM game_records t JOIN game_records o ON o.key='session:'||json_extract(t.value,'$.id')
    JOIN "user" u ON u.id=json_extract(o.value,'$.accountId') AND u."emailVerified"=1
    LEFT JOIN "session" s ON s.id=json_extract(t.value,'$.authSessionId') AND s."userId"=u.id AND julianday(s."expiresAt")>julianday(?)
    WHERE t.key=? AND (t.expires=0 OR t.expires>?) AND (o.expires=0 OR o.expires>?)`).bind(new Date(now).toISOString(), key, now, now).first()
  if (!row) throw denied()
  const token = JSON.parse(row.token), session = JSON.parse(row.owner), authExpiry = +new Date(row.authExpiry)
  if (!Number.isFinite(token.expires) || token.expires <= now) throw denied()
  if (token.role === 'human') {
    if (!Number.isFinite(authExpiry) || authExpiry <= Date.now() || token.accountId !== session.accountId || !token.liveCookieHash || token.liveCookieHash !== cookieHash) throw denied()
  } else if (token.role !== 'agent' || !Number.isSafeInteger(token.version) || token.version !== session.agentVersion || !session.agentGranted) throw denied()
  return { token, session, expires: Math.min(token.expires, token.role === 'human' ? authExpiry : Infinity) }
}
export async function exchange(env, store, ticket, identity) {
  if (!identity || !/^[A-Za-z0-9_-]{32}$/.test(ticket || '')) throw denied()
  const live = nonce()
  await transaction(store, async tx => {
    const key = `live-ticket:${hash(ticket)}`, record = await tx.get(key)
    if (!record?.tokenKey || record.used) throw denied()
    const token = await tx.get(record.tokenKey,null,Math.max(1,Math.ceil((identity.authExpires-Date.now())/1000)))
    if (token?.role !== 'human' || token.accountId !== identity.id || token.authSessionId !== identity.authSessionId || token.expires <= Date.now() || token.liveCookieHash) throw denied()
    token.liveCookieHash = hash(live)
    await tx.set(key, { used: true }, 60)
  })
  return `${cookieName(env)}=${live}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${env.SITE_URL.startsWith('https:') ? '; Secure' : ''}`
}
