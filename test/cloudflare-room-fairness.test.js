import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client, ORIGIN } from './helpers/cloudflare.js'

test('a burst of requests from one player does not hold up the other player', { timeout: 120000 }, async t => {
  const { mf, mail } = await runtime(); let ws; t.after(async () => { ws?.close(); await mf.dispose() })
  const players = []
  for (const name of ['BurstOne', 'BurstTwo']) {
    const c = client(mf); await c.signUp(name)
    const verify = new URL(mail.at(-1).text.match(/http:\/\/[^\s]+/)[0]); await c.call('GET', verify.pathname + verify.search)
    const s = (await c.call('POST', '/session', {})).body; await c.call('POST', '/exchange', { ticket: s.liveTicket })
    players.push({ c, s })
  }
  const [one, two] = players
  const room = await one.c.call('POST', `/rooms?token=${one.s.humanToken}`, { minutes: 3, planets: 16, planning: 10, withAgent: false })
  assert.equal((await two.c.call('POST', `/rooms/join?token=${two.s.humanToken}`, { code: room.body.code })).status, 200)
  assert.equal((await one.c.call('POST', `/rooms/start?token=${one.s.humanToken}`, {})).status, 200)
  let frames = 0, closed = false
  const watch = async () => {
    const r = await mf.dispatchFetch(ORIGIN + `/socket?token=${two.s.humanToken}`, { headers: { upgrade: 'websocket', origin: ORIGIN, cookie: [...two.c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })
    assert.equal(r.status, 101)
    r.webSocket.addEventListener('message', e => { if (typeof e.data !== 'string') frames++ }); r.webSocket.addEventListener('close', () => { closed = true }); r.webSocket.accept()
    return r.webSocket
  }
  ws = await watch()
  await new Promise(done => setTimeout(done, 1500))
  frames = 0
  const burst = await Promise.all(Array.from({ length: 240 }, () => one.c.call('GET', `/state?token=${one.s.humanToken}`).then(r => r.status)))
  const refused = burst.filter(s => s === 429).length, served = burst.filter(s => s === 200).length
  assert.ok(served >= 1, JSON.stringify(burst.slice(0, 20)))
  assert.ok(refused >= 200, `only ${refused} of 240 burst requests were refused`)
  const own = await two.c.call('GET', `/state?token=${two.s.humanToken}`)
  assert.equal(own.status, 200, 'the other player is still served')
  if (closed) { ws = await watch(); frames = 0 }
  await new Promise(done => setTimeout(done, 1500))
  assert.ok(frames > 0, 'the other player still receives frames')
  assert.equal((await one.c.call('GET', `/state?token=${one.s.humanToken}`)).status, 200, 'the burst player is served again afterwards')
})

test('an address sending more than its share is refused before any other work, others are not', { timeout: 120000 }, async t => {
  const { mf } = await runtime({ burst: { limit: 20, period: 60 } }); t.after(() => mf.dispose())
  const c = client(mf), from = ip => ({ 'cf-connecting-ip': ip })
  // The allowance is counted per clock minute: start well inside one.
  const left = 60000 - Date.now() % 60000; if (left < 20000) await new Promise(done => setTimeout(done, left + 500))
  const codes = await Promise.all(Array.from({ length: 30 }, () => c.call('GET', '/rules', undefined, from('198.51.100.7')).then(r => r.status)))
  assert.deepEqual([codes.filter(s => s === 200).length, codes.filter(s => s === 429).length], [20, 10])
  assert.equal((await c.call('GET', '/rules', undefined, from('198.51.100.8'))).status, 200)
  assert.equal((await c.call('GET', '/live-config.json', undefined, from('198.51.100.7'))).status, 200, 'the site itself is still served')
})
