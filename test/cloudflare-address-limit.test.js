import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client } from './helpers/cloudflare.js'

test('per-address allowances count one IPv6 home network as one address', { timeout: 120000 }, async t => {
  const { mf } = await runtime(); t.after(() => mf.dispose())
  const browser = client(mf), codes = []
  const register = ip => browser.call('POST', '/register', { client_name: 'Address proof', redirect_uris: ['http://localhost:4000/callback'], token_endpoint_auth_method: 'none' }, { 'cf-connecting-ip': ip })
  for (let i = 1; i <= 32; i++) codes.push((await register(`2001:db8:12:34:${i.toString(16)}::${i.toString(16)}`)).status)
  assert.deepEqual([codes.filter(c => c === 201).length, codes.filter(c => c === 429).length], [30, 2], JSON.stringify(codes))
  assert.equal((await register('2001:db8:12:35::1')).status, 201, 'a different network keeps its own allowance')
  assert.equal((await register('2001:DB8:12:34:0:0:0:9')).status, 429, 'same network written differently')
})
