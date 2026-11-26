import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client, ORIGIN } from './helpers/cloudflare.js'

test('each player keeps a place to watch the match, whatever the other opens', { timeout: 90000 }, async t => {
  const { mf, mail } = await runtime(); const open = []; t.after(async () => { open.forEach(s => s.close()); await mf.dispose() })
  const players = []
  for (const name of ['SeatOne', 'SeatTwo']) {
    const c = client(mf); await c.signUp(name)
    const verify = new URL(mail.at(-1).text.match(/http:\/\/[^\s]+/)[0]); await c.call('GET', verify.pathname + verify.search)
    const s = (await c.call('POST', '/session', {})).body; await c.call('POST', '/exchange', { ticket: s.liveTicket })
    players.push({ c, s })
  }
  const [one, two] = players
  const room = await one.c.call('POST', `/rooms?token=${one.s.humanToken}`, { minutes: 3, planets: 16, planning: 10, withAgent: false })
  assert.equal(room.status, 200, JSON.stringify(room.body))
  assert.equal((await two.c.call('POST', `/rooms/join?token=${two.s.humanToken}`, { code: room.body.code })).status, 200)
  assert.equal((await one.c.call('POST', `/rooms/start?token=${one.s.humanToken}`, {})).status, 200)
  const watch = async p => {
    const r = await mf.dispatchFetch(ORIGIN + `/socket?token=${p.s.humanToken}`, { headers: { upgrade: 'websocket', origin: ORIGIN, cookie: [...p.c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })
    if (r.status === 101) { r.webSocket.accept(); open.push(r.webSocket) }
    return r.status
  }
  const first = []
  for (let i = 0; i < 9; i++) first.push(await watch(one))
  assert.equal(first.filter(s => s === 101).length, 4, JSON.stringify(first))
  assert.equal(first.at(-1), 429)
  assert.equal(await watch(two), 101, 'the other player still sees the match')
})
