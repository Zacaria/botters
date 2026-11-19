import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runtime, ORIGIN } from './helpers/cloudflare.js'

test('workerd public video serves byte ranges from the asset binding', {timeout:30000}, async t => {
  const {mf}=await runtime({assets:{directory:'public',binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}}})
  t.after(()=>mf.dispose())
  const bytes=await readFile('public/media/public-demo.webm')
  for (const [range,start,end] of [['bytes=10-29',10,29],['bytes=-10',bytes.length-10,bytes.length-1],['bytes=100-',100,bytes.length-1]]) {
    const response=await mf.dispatchFetch(ORIGIN+'/media/public-demo.webm',{headers:{range}})
    if(response.status!==206) await response.body?.cancel()
    assert.equal(response.status,206)
    assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${bytes.length}`)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(start,end+1))
  }
  const invalid=await mf.dispatchFetch(ORIGIN+'/media/public-demo.webm',{headers:{range:`bytes=${bytes.length}-`}})
  assert.equal(invalid.status,416)
  assert.equal(invalid.headers.get('content-range'),`bytes */${bytes.length}`)
})
