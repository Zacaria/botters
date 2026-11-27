import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rangeResponse } from '../cloudflare/media.js'

const CHUNK = 65536, CHUNKS = 40, LENGTH = CHUNK * CHUNKS, byte = i => (i * 7 + (i >> 16)) & 255
function asset(withLength) {
  const seen = { fetches: 0, pulled: 0, cancelled: 0 }
  const fetchAsset = async () => {
    seen.fetches++; seen.pulled = 0; let n = 0
    const body = new ReadableStream({
      pull(c) { if (n === CHUNKS) return c.close(); const chunk = new Uint8Array(CHUNK); for (let i = 0; i < CHUNK; i++) chunk[i] = byte(n * CHUNK + i); n++; seen.pulled++; c.enqueue(chunk) },
      cancel() { seen.cancelled++ }
    }, { highWaterMark: 0 })
    return new Response(body, { headers: withLength ? { 'content-length': String(LENGTH), 'content-type': 'video/webm' } : { 'content-type': 'video/webm' } })
  }
  return { seen, fetchAsset }
}
const ask = (fetchAsset, range, path = '/media/a.webm') => rangeResponse(new Request('https://botters.test' + path, { headers: { range } }), fetchAsset)
const expected = (start, end) => Uint8Array.from({ length: end - start + 1 }, (_, i) => byte(start + i))

test('a byte range is served from the stream without reading the rest of the video', async () => {
  const { seen, fetchAsset } = asset(true)
  const response = await ask(fetchAsset, 'bytes=10-29')
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 10-29/${LENGTH}`)
  assert.equal(response.headers.get('content-length'), '20')
  assert.equal(response.headers.get('content-type'), 'video/webm')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected(10, 29))
  assert.ok(seen.pulled <= 2, `read ${seen.pulled} of ${CHUNKS} chunks`)
  assert.equal(seen.cancelled, 1)
  for (const [range, start, end] of [['bytes=-10', LENGTH - 10, LENGTH - 1], ['bytes=100-', 100, LENGTH - 1], [`bytes=${CHUNK - 5}-${CHUNK * 2 + 4}`, CHUNK - 5, CHUNK * 2 + 4]]) {
    const r = await ask(fetchAsset, range)
    assert.equal(r.headers.get('content-range'), `bytes ${start}-${end}/${LENGTH}`)
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), expected(start, end))
  }
  const invalid = await ask(fetchAsset, `bytes=${LENGTH}-`)
  assert.equal(invalid.status, 416)
  assert.equal(invalid.headers.get('content-range'), `bytes */${LENGTH}`)
})

test('an asset without a declared length is measured once, then ranges stream', async () => {
  const { seen, fetchAsset } = asset(false)
  const first = await ask(fetchAsset, 'bytes=10-29', '/media/b.webm')
  assert.equal(first.status, 206)
  assert.equal(first.headers.get('content-range'), `bytes 10-29/${LENGTH}`)
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), expected(10, 29))
  assert.equal(seen.fetches, 2)
  const second = await ask(fetchAsset, `bytes=${CHUNK * 3}-${CHUNK * 3 + 9}`, '/media/b.webm')
  assert.deepEqual(new Uint8Array(await second.arrayBuffer()), expected(CHUNK * 3, CHUNK * 3 + 9))
  assert.equal(seen.fetches, 3)
  assert.ok(seen.pulled <= 5, `read ${seen.pulled} of ${CHUNKS} chunks`)
})

test('an asset answer that is not a full body is passed through', async () => {
  const response = await ask(async () => new Response(null, { status: 404 }), 'bytes=0-1', '/media/c.webm')
  assert.equal(response.status, 404)
})
