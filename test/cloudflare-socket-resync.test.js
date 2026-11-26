import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client, ORIGIN } from './helpers/cloudflare.js'

test('repeated resync requests from one connection are answered once at a time', { timeout: 90000 }, async t => {
  const { mf, mail } = await runtime(); let ws; t.after(async () => { ws?.close(); await mf.dispose() })
  const c = client(mf); await c.signUp('Resync')
  const verify = new URL(mail[0].text.match(/http:\/\/[^\s]+/)[0]); await c.call('GET', verify.pathname + verify.search)
  const s = (await c.call('POST', '/session', {})).body; await c.call('POST', '/exchange', { ticket: s.liveTicket })
  assert.equal((await c.call('POST', `/play?token=${s.humanToken}`, { withAgent: false, vs: 'normal', minutes: 3, planets: 16, planning: 10 })).status, 200)
  const r = await mf.dispatchFetch(ORIGIN + `/socket?token=${s.humanToken}`, { headers: { upgrade: 'websocket', origin: ORIGIN, cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })
  assert.equal(r.status, 101); ws = r.webSocket
  let frames = 0; ws.addEventListener('message', e => { if (typeof e.data !== 'string') frames++ }); ws.accept()
  await new Promise(done => setTimeout(done, 1000))
  frames = 0
  for (let i = 0; i < 400; i++) ws.send(JSON.stringify({ t: 'resync' }))
  await new Promise(done => setTimeout(done, 6000))
  // Six seconds at 10 Hz is about 60 frames; 400 queued answers would far exceed it.
  assert.ok(frames > 0 && frames < 150, `frames received: ${frames}`)
  const started = performance.now()
  assert.equal((await c.call('GET', `/state?token=${s.humanToken}`)).status, 200)
  assert.ok(performance.now() - started < 3000, 'the match still answers promptly')
})
