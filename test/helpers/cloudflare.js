import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { readFile } from 'node:fs/promises'
export const ORIGIN = 'http://localhost:8787'
export async function runtime(options = {}) {
  const { bindings = {}, ...runtimeOptions } = options
  const mail = []
  const optionsV5 = convertV4MiniflareOptions({
    name: 'botters-local',
    modules: [{ type: 'ESModule', path: '.cache/cloudflare/worker.js' }, { type: 'CompiledWasm', path: '.cache/cloudflare/botters_sim_bg.wasm' }],
    compatibilityDate: '2026-11-08', compatibilityFlags: ['nodejs_compat'],
    bindings: { SITE_URL: ORIGIN, BETTER_AUTH_SECRET: 'local-workerd-test-only-secret-1234567890', AUTH_EMAIL_FROM: 'botters@mail.havesomecode.io', AUTH_EMAIL_ALLOWED_RECIPIENTS: ['alice','bob','mcpowner','revoke','reset','delete','cadence'].map(n=>`${n}@example.invalid`).join(','), ...bindings },
    d1Databases: { DB: 'botters-local' }, durableObjects: { MATCHES: { className: 'MatchRoom', useSQLite: true }, AGENTS: { className: 'AgentGateway', useSQLite: true } },
    ...runtimeOptions,
  })
  optionsV5.unsafeLocalExplorer = true
  optionsV5.workers[0].config.name = 'botters-local'
  optionsV5.workers[0].config.env.EMAIL = { type: 'send-email', allowedSenderAddresses: ['botters@mail.havesomecode.io'] }
  const mf = new Miniflare(optionsV5)
  const captured = new Set()
  mf.captureMail = async () => {
    const path = ORIGIN + '/cdn-cgi/local/explorer/api/local/email/sending?worker=botters-local'
    const r = await mf.dispatchFetch(path)
    if (!r.ok) throw new Error(`Local native mailbox unavailable: ${r.status}`)
    const list = await r.json()
    for (const item of list.result.toSorted((a,b)=>String(a.sentAt).localeCompare(String(b.sentAt)))) if (!captured.has(item.messageId)) {
      const detail = await (await mf.dispatchFetch(path + '&email_id=' + encodeURIComponent(item.messageId))).json()
      mail.push(detail.result); captured.add(item.messageId)
    }
  }
  const db = await mf.getD1Database('DB')
  const schema = await readFile('cloudflare/migrations/0001_initial.sql', 'utf8')
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)))
  return { mf, db, mail }
}
export function client(mf) {
  const cookies = new Map()
  const call = async (method, path, data, extra = {}) => {
    const headers = { origin: ORIGIN, cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...extra }
    if (data !== undefined) headers['content-type'] = 'application/json'
    const r = await mf.dispatchFetch(ORIGIN + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'manual' })
    for (const c of r.headers.getSetCookie()) { const [name, ...parts] = c.split(';')[0].split('='); cookies.set(name, parts.join('=')) }
    const text = await r.text(); let body
    try { body = JSON.parse(text) } catch { body = text }
    if (path.startsWith('/api/auth/')) await mf.captureMail()
    return { status: r.status, body, headers: r.headers }
  }
  return { call, cookies, async signUp(name) {
    const email = `${name.toLowerCase()}@example.invalid`, password = 'Local-proof-password-1234'
    const r = await call('POST', '/api/auth/sign-up/email', { name, email, password })
    return { ...r, email, password }
  } }
}
