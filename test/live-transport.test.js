import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectLive } from '../browser-live.js'

test('online resync sends a wire message on the active socket', () => {
  const original = globalThis.WebSocket
  const sockets = []
  class Socket {
    static OPEN = 1
    constructor(url) { this.url = url; this.readyState = Socket.OPEN; this.sent = []; sockets.push(this) }
    send(data) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3 }
  }
  globalThis.WebSocket = Socket
  try {
    const live = connectLive('https://example.test', 'secret', () => {}, () => {})
    live.resync()
    assert.deepEqual(sockets[0].sent, [{ t: 'resync' }])
    live.close()
  } finally { globalThis.WebSocket = original }
})
