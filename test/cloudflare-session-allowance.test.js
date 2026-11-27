import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client } from './helpers/cloudflare.js'

test('another account on the same address can still start a session', { timeout: 240000 }, async t => {
  const { mf, mail } = await runtime(); t.after(() => mf.dispose())
  const a = client(mf), b = client(mf), headers = { 'cf-connecting-ip':'198.51.100.7' }
  for (const [c,name] of [[a,'SessionAlice'],[b,'SessionBob']]) {
    assert.equal((await c.signUp(name)).status,200)
    const verify = new URL(mail.at(-1).text.match(/http:\/\/[^\s]+/)[0])
    assert.equal((await c.call('GET',verify.pathname+verify.search)).status,302)
  }
  const left = 600000 - Date.now() % 600000; if (left < 120000) await new Promise(done => setTimeout(done,left+500))
  for (let i = 0; i < 20; i++) assert.equal((await a.call('POST','/session',{},headers)).status,200)
  assert.equal((await b.call('POST','/session',{},headers)).status,200)
  for (let i = 20; i < 30; i++) assert.equal((await a.call('POST','/session',{},headers)).status,200)
  assert.equal((await a.call('POST','/session',{},headers)).status,429)
  assert.equal((await b.call('POST','/session',{},headers)).status,200)
})
