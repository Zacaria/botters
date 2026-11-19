import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliver } from '../cloudflare/auth.js'
import { readFile } from 'node:fs/promises'
test('native Email binding: exact payload, sender guard, unrestricted recipients and failed sends', async () => {
  const calls=[], env={AUTH_EMAIL_FROM:'botters@mail.havesomecode.io',EMAIL:{send:async m=>{calls.push(m);return {messageId:'local-synthetic-contract-only'}}}}
  const message={to:'owner@example.invalid',subject:'Verify Botters',text:'Test link',html:'must not forward',bcc:'must-not-forward@example.invalid'}
  await deliver(env,message)
  assert.deepEqual(calls,[{from:env.AUTH_EMAIL_FROM,to:message.to,subject:message.subject,text:message.text}])
  await assert.rejects(deliver({...env,EMAIL:undefined},message))
  await assert.rejects(deliver({...env,AUTH_EMAIL_FROM:'botters@unowned.invalid'},message))
  await deliver(env,{...message,to:'outside@example.invalid'})
  await assert.rejects(deliver({...env,EMAIL:{send:async()=>{throw new Error('provider body secret')}}},message),/Email delivery is unavailable\./)
  await assert.rejects(deliver({...env,EMAIL:{send:async()=>undefined}},message))
  assert.equal(calls.length,2)
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'))
  assert.equal(config.send_email[0].name,'EMAIL')
  assert.deepEqual(config.send_email[0].allowed_sender_addresses,['botters@mail.havesomecode.io'])
})
