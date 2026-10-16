import { Client } from '@colyseus/sdk'

// Rejoining by room ID and reauthenticating preserves the match, not a socket.
export function connectLive(origin, token, onFrame, onDisconnect) {
  let closed = false, room, retry, connecting = false
  const client = new Client(origin)
  const connect = async () => {
    if (closed || connecting) return
    connecting = true
    try {
      const response = await fetch(`${origin}/socket?token=${encodeURIComponent(token)}`)
      if (!response.ok) throw new Error('Live connection unavailable')
      const { roomId } = await response.json()
      const next = await client.joinById(roomId, { token })
      if (closed) { await next.leave(); return }
      room = next
      next.onMessage('frame', frame => { if (!closed && room === next) onFrame(frame) })
      next.onMessage('unavailable', () => { if (!closed) onDisconnect() })
      next.onLeave(() => { if (!closed && room === next) { onDisconnect(); retry = setTimeout(connect, 1000) } })
      next.onError(() => { if (!closed) onDisconnect() })
    } catch { if (!closed) { onDisconnect(); retry = setTimeout(connect, 1000) } }
    finally { connecting = false }
  }
  void connect()
  return { close() { closed = true; clearTimeout(retry); void room?.leave() } }
}
