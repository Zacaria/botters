export function connectLive(origin, token, onFrame, onDisconnect) {
  let closed = false, socket, retry
  const connect = () => {
    if (closed) return
    const url = new URL('/socket', origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('token', token)
    const next = new WebSocket(url)
    socket = next
    next.onmessage = event => { if (!closed && socket === next) { try { onFrame(JSON.parse(event.data)) } catch { onDisconnect() } } }
    next.onclose = () => { if (!closed && socket === next) { onDisconnect(); retry = setTimeout(connect, 1000) } }
    next.onerror = () => { if (!closed && socket === next) onDisconnect() }
  }
  connect()
  return { close() { closed = true; clearTimeout(retry); socket?.close() } }
}
