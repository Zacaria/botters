// The replica never predicts beyond an announced tick. A snapshot replaces all
// pending inputs and hashes, including after reconnecting or a resync.
export function createReplica(sim, requestSnapshot) {
  let state = null, side = null, nextI = 0, target = 0, accumulator = 0, resyncing = false
  let inputs = [], localHashes = new Map(), serverHashes = new Map()
  const resync = () => { if (!resyncing) { resyncing = true; requestSnapshot() } }
  const compare = tick => {
    if (localHashes.has(tick) && serverHashes.has(tick)) {
      if (localHashes.get(tick) !== serverHashes.get(tick)) resync()
      localHashes.delete(tick); serverHashes.delete(tick)
    }
  }
  const record = () => {
    if (state.tick % 20 === 0) { localHashes.set(state.tick, sim.hash(state)); compare(state.tick) }
  }
  return {
    get state() { return state },
    get side() { return side },
    receive(message) {
      if (message.t === 'snap') {
        state = sim.restore(message.state); side = message.side; nextI = message.log
        target = state.tick; accumulator = 0; inputs = []; localHashes = new Map(); serverHashes = new Map(); resyncing = false
        record()
      } else if (message.t === 'step' && state && !resyncing) {
        for (const entry of message.inputs) {
          if (entry.i !== nextI || entry.tick < state.tick) { resync(); return }
          nextI++; inputs.push(entry)
        }
        target = Math.max(target, message.tick)
        if (message.hash) { const [tick, h] = message.hash; serverHashes.set(tick, h); compare(tick) }
      }
    },
    advance(elapsed) {
      if (!state || resyncing) return
      accumulator += Math.max(0, elapsed)
      // Catch up in bounded batches without spending minutes replaying a hidden tab.
      let budget = target - state.tick > 40 ? 100 : Math.floor(accumulator / 50)
      budget = Math.min(budget, 100)
      // Inputs at the current tick apply as soon as they arrive: the server applied them in log order with no step between,
      // which also lands a final surrender logged at the last announced tick.
      const drain = () => { while (inputs.length && inputs[0].tick === state.tick) { const entry = inputs.shift(); sim.applyInput(state, entry.side, entry.input) } }
      drain()
      while (budget-- > 0 && state.tick < target && !resyncing && !state.ended) {
        if (inputs.length && inputs[0].tick < state.tick) { resync(); break }
        sim.step(state); accumulator = Math.max(0, accumulator - 50); record(); drain()
      }
      if (state.tick >= target) accumulator = Math.min(accumulator, 50)
    },
  }
}

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
  return {
    resync() { if (!closed && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'resync' })) },
    close() { closed = true; clearTimeout(retry); socket?.close() },
  }
}
