import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fork, execFile } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import net from 'node:net'
import { promisify } from 'node:util'
import pg from 'pg'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'

const database = process.env.BOTTERS_TEST_POSTGRES_URL
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const fixture = new URL('./fixtures/botters-real-journey/service.js', import.meta.url)
async function port() {
  const server = net.createServer().listen(0, '127.0.0.1'); await once(server, 'listening')
  const n = server.address().port; await new Promise(resolve => server.close(resolve)); return n
}
async function start(mode, env, mails) {
  const actualLive = mode === 'live' && process.env.BOTTERS_JOURNEY_REAL_LIVE === '1'
  const actualHttp = mode === 'control' && process.env.BOTTERS_JOURNEY_REAL_HTTP === '1'
  const liveDatabase = new URL(env.JOURNEY_DATABASE)
  liveDatabase.searchParams.set('options', `-c search_path=${env.JOURNEY_SCHEMA}`)
  const entry = actualLive ? new URL('../scripts/live-server.js', import.meta.url) : actualHttp ? new URL('../scripts/postgres-http-server.js', import.meta.url) : fixture
  const common = { DATABASE_URL: liveDatabase.toString(), BOTTERS_STORE_NAMESPACE: 'journey', HOST: '127.0.0.1' }
  const actualEnv = actualLive ? { ...common, BOTTERS_LIVE_BACKEND: 'postgres', BOTTERS_REQUIRE_ACCOUNT: '1', PLAYER_ORIGINS: env.JOURNEY_SITE, PORT: env.JOURNEY_LIVE_PORT } : actualHttp ? { ...common, SITE_URL: env.JOURNEY_SITE, BOTTERS_AUTH_ORIGIN: env.JOURNEY_SITE, BETTER_AUTH_SECRET: 'isolated-journey-test-secret-123456789012345', RESEND_API_KEY: 'synthetic', AUTH_EMAIL_FROM: 'botters@example.test', PORT: new URL(env.JOURNEY_SITE).port } : {}
  const p = fork(entry, [], { env: { ...process.env, ...env, JOURNEY_MODE: mode, ...actualEnv }, ...(actualHttp ? { execArgv: ['--import', new URL('./fixtures/botters-real-journey/capture-mail.js', import.meta.url).pathname] } : {}), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let stdout = ''
  if (actualLive || actualHttp) p.stdout.on('data', b => { stdout += b; if (stdout.includes(actualLive ? '"service":"botters-live"' : '"service":"botters-control"')) p.emit('message', { type: 'ready' }) })
  let stderr = ''; p.stderr.on('data', b => { stderr += b; p.journeyStderr = stderr })
  p.on('message', message => { if (message.type === 'mail') mails.push(message) })
  try {
    await Promise.race([
      new Promise(resolve => p.on('message', m => { if (m.type === 'ready') resolve() })),
      once(p, 'exit').then(([code]) => { throw new Error(`${mode} exited ${code}: ${stderr}`) }),
      sleep(10000).then(() => { throw new Error(`${mode} startup timed out: ${stderr}`) }),
    ])
    return p
  } catch (e) { p.kill('SIGTERM'); throw e }
}
async function stop(p) {
  if (!p || p.exitCode !== null || p.signalCode !== null) return
  const exit = once(p, 'exit'); p.kill('SIGTERM')
  const [code, signal] = await Promise.race([exit, sleep(8000).then(() => { p.kill('SIGKILL'); throw new Error('process did not stop') })])
  assert.equal(code, 0, `exit signal ${signal}`)
}
const request = (base, path, { body, cookie, origin = base, method } = {}) => fetch(base + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: AbortSignal.timeout(5000) })

test('two accounts over separate HTTP and Colyseus harness processes with PostgreSQL authority', { skip: !database, timeout: 60000 }, async t => {
  const target = new URL(database)
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol) && target.hostname === '127.0.0.1' && !target.search, 'use a dedicated loopback PostgreSQL database')
  const schema = `botters_journey_${randomUUID().replaceAll('-', '')}`, admin = new pg.Pool({ connectionString: database })
  let pool, control, live, proxy
  const sockets = new Set()
  let allowDatabase = true
  const mails = []
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    pool = new pg.Pool({ connectionString: database, options: `-c search_path=${schema}` })
    const site = `http://127.0.0.1:${await port()}`, livePort = await port(), liveUrl = `http://127.0.0.1:${livePort}`
    const auth = await createPostgresAuth({ pool, env: { SITE_URL: site, BETTER_AUTH_SECRET: 'isolated-journey-test-secret-123456789012345' }, sendEmail: async () => {} })
    await auth.migrate(); await new PostgresStore(pool, 'journey').init()
    const env = { JOURNEY_DATABASE: database, JOURNEY_SCHEMA: schema, JOURNEY_SITE: site, JOURNEY_LIVE_PORT: String(livePort) }
    // A loopback TCP cut affects only the live process, not the database or control process.
    proxy = net.createServer(client => {
      sockets.add(client); client.on('close', () => sockets.delete(client)); client.on('error', () => {})
      if (!allowDatabase) return client.destroy()
      const upstream = net.connect(Number(target.port || 5432), '127.0.0.1')
      sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream)); upstream.on('error', () => client.destroy())
      client.pipe(upstream).pipe(client)
    }).listen(0, '127.0.0.1')
    await once(proxy, 'listening')
    const proxyUrl = new URL(database); proxyUrl.port = String(proxy.address().port)
    const liveEnv = { ...env, JOURNEY_DATABASE: proxyUrl.toString() }
    control = await start('control', env, mails); live = await start('live', liveEnv, mails)
    const postAuth = (path, body, cookie) => request(site, '/api/auth' + path, { body, cookie })
    async function account(name) {
      const email = `${name}@example.test`, password = 'synthetic-password-12345!'
      assert.equal((await postAuth('/sign-up/email', { email, password, name, callbackURL: '/' })).status, 200)
      assert.equal((await postAuth('/sign-in/email', { email, password })).status, 403)
      const mail = mails.findLast(m => m.to === email); assert.ok(mail, 'captured synthetic verification mail')
      const verification = mail.text.match(/http:\/\/\S+/)?.[0]; assert.ok(verification)
      const u = new URL(verification); assert.equal(u.origin, site)
      assert.equal((await fetch(verification, { redirect: 'manual' })).status, 302)
      const login = await postAuth('/sign-in/email', { email, password }); assert.equal(login.status, 200)
      const cookie = login.headers.getSetCookie().map(s => s.split(';')[0]).join('; '); assert.ok(cookie)
      if (process.env.BOTTERS_JOURNEY_REAL_HTTP === '1') {
        const current = await (await request(site, '/account', { cookie })).json()
        assert.ok(current.user, 'actual control resolves the authenticated account')
        const result = await pool.query('SELECT id FROM session WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1', [current.user.id])
        assert.equal(result.rowCount, 1)
        return { cookie, id: current.user.id, authSessionId: result.rows[0].id }
      }
      const sessionResponse = await request(site, '/api/auth/get-session', { cookie }); const session = await sessionResponse.json(); assert.ok(session.user, `get-session status ${sessionResponse.status}, fields ${Object.keys(session).join(',')}`); assert.equal(session.user.email, email)
      return { cookie, id: session.user.id, authSessionId: session.session.id }
    }
    const a = await account('alice'), b = await account('bob'); assert.notEqual(a.id, b.id)
    await stop(control); control = await start('control', env, mails)
    const sessionPath = process.env.BOTTERS_JOURNEY_REAL_HTTP === '1' ? '/account' : '/api/auth/get-session'
    assert.equal((await (await request(site, sessionPath, { cookie: a.cookie })).json()).user.id, a.id, 'session survives control process restart')
    assert.equal((await request(site, '/session', { body: {} })).status, 401)
    assert.equal((await request(site, '/session', { body: {}, cookie: 'better-auth.session_token=invalid' })).status, 401)
    async function grant(account) {
      const response = await request(site, '/session', { body: {}, cookie: account.cookie }); assert.equal(response.status, 200)
      return response.json()
    }
    const ga = await grant(a), gb = await grant(b); assert.notEqual(ga.sessionId, gb.sessionId)
    const exchange = ticket => request(liveUrl, '/exchange', { body: { ticket }, origin: site })
    const attempts = await Promise.all(Array.from({ length: 8 }, () => exchange(ga.liveTicket)))
    assert.equal(attempts.filter(r => r.status === 200).length, 1, 'one ticket has one concurrent winner')
    const liveCookieA = attempts.find(r => r.status === 200).headers.getSetCookie()[0].split(';')[0]
    const rb = await exchange(gb.liveTicket); assert.equal(rb.status, 200)
    const liveCookieB = rb.headers.getSetCookie()[0].split(';')[0]
    const lobby = (token, cookie) => request(liveUrl, `/lobby?token=${token}`, { cookie, origin: site })
    assert.equal((await lobby(ga.humanToken)).status, 401)
    assert.equal((await lobby('x'.repeat(32), liveCookieA)).status, 401)
    assert.equal((await lobby(ga.humanToken, liveCookieB)).status, 401, 'another account cookie cannot authorize')
    assert.equal((await lobby(ga.humanToken, liveCookieA)).status, 200)
    assert.equal((await lobby(gb.humanToken, liveCookieB)).status, 200)
    const play = await request(liveUrl, `/play?token=${ga.humanToken}`, { body: { vs: 'easy', withAgent: false }, cookie: liveCookieA, origin: site })
    assert.equal(play.status, 200, 'real live game starts')
    const socket = await request(liveUrl, `/socket?token=${ga.humanToken}`, { cookie: liveCookieA, origin: site }); assert.equal(socket.status, 200)
    const { roomId } = await socket.json(); assert.ok(roomId)
    assert.equal((await request(liveUrl, `/matchmake/joinById/${roomId}`, { body: { token: gb.humanToken }, cookie: liveCookieB, origin: site })).status, 409)
    // Node 24's global WebSocket cannot attach Cookie; use SDK's Node transport.
    const originalWebSocket = globalThis.WebSocket
    globalThis.WebSocket = (await import('ws')).default
    const { Client } = await import('@colyseus/sdk')
    globalThis.WebSocket = originalWebSocket
    const client = new Client(liveUrl, { headers: { Cookie: liveCookieA, Origin: site } })
    const room = await client.joinById(roomId, { token: ga.humanToken })
    const firstFrame = new Promise(resolve => room.onMessage('frame', resolve))
    assert.ok((await Promise.race([firstFrame, sleep(5000).then(() => { throw new Error('no WebSocket frame') })])).matchId)
    const closed = new Promise(resolve => room.onLeave(code => resolve(code)))
    const begin = performance.now()
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `import pg from 'pg'; const p=new pg.Pool({connectionString:process.env.JOURNEY_DATABASE,options:'-c search_path='+process.env.JOURNEY_SCHEMA}); const r=await p.query('DELETE FROM session WHERE id=$1',[process.env.JOURNEY_ID]); await p.end(); if(r.rowCount!==1)process.exit(1);`], { env: { ...process.env, JOURNEY_DATABASE: database, JOURNEY_SCHEMA: schema, JOURNEY_ID: a.authSessionId } })
    let status, until = performance.now() + 5000
    while (performance.now() < until) { status = (await lobby(ga.humanToken, liveCookieA)).status; if (status === 401) break; await sleep(50) }
    t.diagnostic(`interprocess revocation observed HTTP ${status} after ${(performance.now() - begin).toFixed(1)} ms (includes subprocess startup); not an instant-propagation claim`)
    assert.equal(status, 401, 'revocation must propagate to live HTTP')
    const closeCode = await Promise.race([closed, sleep(5000).then(() => { throw new Error('revoked WebSocket stayed open') })])
    t.diagnostic(`revoked WebSocket closed with ${closeCode} after ${(performance.now() - begin).toFixed(1)} ms`)
    assert.equal(closeCode, 4003)
    assert.equal((await lobby(gb.humanToken, liveCookieB)).status, 200, 'other account survives revocation')
    assert.equal((await request(site, '/session', { body: {}, cookie: a.cookie })).status, 401)
    const loadStart = performance.now()
    const load = await Promise.all(Array.from({ length: 48 }, () => lobby(gb.humanToken, liveCookieB)))
    assert.ok(load.every(r => r.status === 200), '48 concurrent valid requests succeed')
    t.diagnostic(`48 concurrent requests: ${(performance.now() - loadStart).toFixed(1)} ms; bounded smoke load, not capacity qualification`)
    await stop(live); live = await start('live', liveEnv, mails)
    assert.equal((await lobby(gb.humanToken, liveCookieB)).status, 200, 'valid authority recovers after live restart')
    assert.notEqual((await request(liveUrl, `/socket?token=${ga.humanToken}`, { cookie: liveCookieA, origin: site })).status, 200, 'revoked session does not recover on restart')
    assert.equal((await request(liveUrl, `/play?token=${gb.humanToken}`, { body: { vs: 'easy', withAgent: false }, cookie: liveCookieB, origin: site })).status, 200)
    const bSocket = await request(liveUrl, `/socket?token=${gb.humanToken}`, { cookie: liveCookieB, origin: site })
    assert.equal(bSocket.status, 200)
    const bClient = new Client(liveUrl, { headers: { Cookie: liveCookieB, Origin: site } })
    const bRoom = await bClient.joinById((await bSocket.json()).roomId, { token: gb.humanToken })
    let frames = 0
    const firstBFrame = new Promise(resolve => bRoom.onMessage('frame', frame => { frames++; resolve(frame) }))
    await Promise.race([firstBFrame, sleep(5000).then(() => { throw new Error('no pre-outage WebSocket frame') })])
    const bClosed = new Promise(resolve => bRoom.onLeave(resolve))
    allowDatabase = false; for (const socket of sockets) socket.destroy()
    await Promise.race([bClosed, sleep(6000).then(() => { throw new Error('WebSocket remained open after loss of authority') })])
    const stoppedFrames = frames
    await sleep(300)
    assert.equal(frames, stoppedFrames, 'no gameplay frames after the authority closes the socket')
    await sleep(2200) // Existing successful snapshot lease is at most 2 seconds.
    if (live.exitCode !== null) t.diagnostic(`live exit code ${live.exitCode}; stderr classification: ${/idle client/.test(live.journeyStderr || '') ? 'idle PostgreSQL client error' : 'other error (not printed)'}`)
    assert.equal(live.exitCode, null, 'live process must survive loss of its database connection')
    assert.equal((await lobby(gb.humanToken, liveCookieB)).status, 503, 'network cut fails closed, not as a revoked session')
    allowDatabase = true
    let recovered = 0, recoveryDeadline = performance.now() + 5000
    while (performance.now() < recoveryDeadline) { recovered = (await lobby(gb.humanToken, liveCookieB)).status; if (recovered === 200) break; await sleep(100) }
    assert.equal(recovered, 200, 'authority recovers after network restoration')
    assert.equal((await postAuth('/request-password-reset', { email: 'bob@example.test', redirectTo: '/' })).status, 200)
    const resetMail = mails.findLast(m => m.to === 'bob@example.test')
    const resetLink = resetMail?.text.match(/http:\/\/\S+/)?.[0]; assert.ok(resetLink)
    const resetUrl = new URL(resetLink); assert.equal(resetUrl.origin, site)
    const redirect = await fetch(resetUrl, { redirect: 'manual' })
    const token = new URL(redirect.headers.get('location'), site).searchParams.get('token'); assert.ok(token)
    const newPassword = 'new-synthetic-password-456!'
    assert.equal((await postAuth('/reset-password', { token, newPassword })).status, 200)
    assert.equal((await postAuth('/reset-password', { token, newPassword })).status, 400, 'reset token is single-use')
    assert.equal((await request(site, '/session', { body: {}, cookie: b.cookie })).status, 401, 'password reset revokes prior session')
    assert.equal((await postAuth('/sign-in/email', { email: 'bob@example.test', password: newPassword })).status, 200, 'new password signs in')
  } finally {
    await stop(live); await stop(control)
    for (const socket of sockets) socket.destroy()
    if (proxy) await new Promise(resolve => proxy.close(resolve))
    if (pool) await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end()
  }
})
