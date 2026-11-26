// MCP Apps view (io.modelcontextprotocol/ui): a read-only live map of the agent's current match, drawn inside Claude, ChatGPT
// or any MCP Apps host. The view has no network access: it refreshes through the host bridge.
// Spec and host notes: docs/specs/mcp-apps-poc.md.
export const MATCH_VIEW_URI = 'ui://botters/match'
export const MATCH_VIEW_MIME = 'text/html;profile=mcp-app'

// Runs inside the host's sandboxed iframe. Self-contained: it is serialized into the HTML with Function.prototype.toString.
function view({ W, H }) {
  const $ = id => document.getElementById(id), cv = $('map'), g = cv.getContext('2d')
  cv.width = W; cv.height = H
  const camps = ['#ff5096', '#3c8cff'] // same palette as the game page: you pink, enemy blue
  let nextId = 1, stopped = false, polling = false, host = {}, cur = null, prev = null, arrived = 0, period = 1000, frameTool = true
  const hostContext = context => { Object.assign(host, context || {}); document.documentElement.classList.toggle('full', host.displayMode === 'fullscreen') }
  const pending = new Map()
  const post = message => window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*')
  const request = (method, params) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); post({ id, method, params }) })
  const notify = (method, params = {}) => post({ method, params })
  addEventListener('message', event => {
    const m = event.data
    if (event.source !== window.parent || !m || m.jsonrpc !== '2.0') return
    if (m.id != null && !m.method && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); return m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) }
    if (m.method === 'ui/notifications/tool-result') take(m.params)
    else if (m.method === 'ui/notifications/host-context-changed') hostContext(m.params)
    else if (m.method === 'ui/resource-teardown') { stopped = true; post({ id: m.id, result: {} }) }
    else if (m.method === 'ping' && m.id != null) post({ id: m.id, result: {} })
  })
  function take(result) {
    const f = result?.structuredContent
    if (!f || typeof f !== 'object') return
    if (f.view && cur?.view && f.matchId === cur.matchId) {
      const planets = new Map(cur.view.planets.map(p => [p.id, p]))
      f.view.planets = f.view.planets.map(p => {
        const old = planets.get(p.id)
        return old ? { x: old.x, y: old.y, r: old.r, ...p } : p
      })
      prev = cur
    } else prev = null
    cur = f; arrived = performance.now()
    hud()
  }
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value }
  function hud() {
    const v = cur?.view
    if (!v) { text('status', cur?.message || 'Waiting for a match…'); text('score', ''); return }
    const clock = Math.ceil(v.secondsLeft), m = Math.floor(clock / 60), s = String(clock % 60).padStart(2, '0')
    text('status', v.ended ? `Match over: you ${v.ended.result} (${v.ended.reason})` : cur.startsIn > 0 ? `Starts in ${cur.startsIn}s · vs ${cur.opponent}` : `${m}:${s} left · vs ${cur.opponent}`)
    text('score', `Units ${v.totals.you} – ${v.totals.enemy} · Planets ${v.totals.planets.you} – ${v.totals.planets.enemy}`)
  }
  const lerp = (list, before, a) => list.map(b => { const o = before?.find(p => p.id === b.id); return o ? { ...b, x: o.x + (b.x - o.x) * a, y: o.y + (b.y - o.y) * a } : b })
  function draw(now) {
    if (!stopped) requestAnimationFrame(draw)
    g.fillStyle = '#0a0a10'; g.fillRect(0, 0, W, H)
    const v = cur?.view
    if (!v) return
    const a = Math.min(1, (now - arrived) / period)
    for (const p of v.planets) {
      const col = p.owner === null ? '#666' : camps[p.owner === 'you' ? 0 : 1]
      g.globalAlpha = .35; g.fillStyle = col; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); g.globalAlpha = 1
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, p.r + 3, 0, 7); g.stroke()
      if (p.capture > 0 && p.capture < 100) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, p.r + 7, -Math.PI / 2, -Math.PI / 2 + p.capture / 100 * Math.PI * 2); g.stroke() }
    }
    const blob = (b, col, label) => {
      const r = 14 + Math.sqrt(b.n) * 1.6
      g.globalAlpha = .3; g.fillStyle = col; g.beginPath(); g.arc(b.x, b.y, r, 0, 7); g.fill(); g.globalAlpha = 1
      g.strokeStyle = b.fighting ? 'rgba(255,90,90,.9)' : col; g.lineWidth = 2; g.setLineDash(b.manual ? [] : [4, 5]); g.beginPath(); g.arc(b.x, b.y, r, 0, 7); g.stroke(); g.setLineDash([])
      g.font = 'bold 18px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(label, b.x, b.y)
    }
    for (const b of lerp(v.enemies, prev?.view?.enemies, a)) blob(b, camps[1], String(b.n))
    lerp(v.battalions, prev?.view?.battalions, a).forEach((b, i) => blob(b, camps[0], String(i + 1)))
  }
  async function poll() {
    if (polling) return
    polling = true
    const started = Date.now()
    while (!stopped && !cur?.view?.ended && Date.now() - started < 30 * 60 * 1000) {
      const t = performance.now()
      try {
        const known = cur?.matchId && cur.view?.planets?.every(p => [p.x, p.y, p.r].every(Number.isFinite)) ? cur.matchId : undefined
        let result
        if (frameTool) {
          try {
            result = await request('tools/call', { name: 'match_frame', arguments: known ? { known } : {} })
            if (result?.isError) throw new Error('match_frame refused')
          } catch { frameTool = false }
        }
        if (!frameTool) result = await request('tools/call', { name: 'show_match', arguments: {} })
        if (result?.isError) throw new Error('show_match refused')
        take(result)
      } catch (e) { text('status', `Map paused: ${e.message}`) }
      period = Math.max(1000, performance.now() - t)
      await new Promise(r => setTimeout(r, Math.max(0, (cur?.view ? 1000 : 3000) - (performance.now() - t))))
    }
    polling = false
  }
  // Report the content height, not the iframe's: documentElement.scrollHeight never shrinks below the frame the host gave us.
  const resize = () => notify('ui/notifications/size-changed', { height: Math.ceil(document.body.getBoundingClientRect().height) })
  new ResizeObserver(resize).observe(document.body)
  $('full').onclick = () => request('ui/request-display-mode', { mode: host.displayMode === 'fullscreen' ? 'inline' : 'fullscreen' }).then(r => { if (r?.mode) hostContext({ displayMode: r.mode }) }, () => {})
  requestAnimationFrame(draw)
  request('ui/initialize', { appInfo: { name: 'Botters match', version: '1.0.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26' }).then(r => {
    hostContext(r?.hostContext)
    notify('ui/notifications/initialized')
    if (host.availableDisplayModes?.includes('fullscreen')) $('full').hidden = false
    // Hosts that proxy tool calls let the map follow the match; others show the snapshot from the tool result.
    if (r?.hostCapabilities?.serverTools) poll()
    resize()
  }, e => text('status', `Host refused the view: ${e.message}`))
}

export function matchViewHtml({ W, H }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Botters match</title>
<style>
  html, body { margin: 0; background: #0a0a10; color: #ddd; color-scheme: dark; overflow: hidden; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace }
  html.full, html.full body { overflow: auto }
  .full canvas { width: min(100%, calc((100vh - 80px) * ${W} / ${H})); margin: 0 auto }
  header { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; justify-content: space-between; padding: 8px 10px }
  @media (max-width: 480px) { html, body { font-size: 11px } #score { order: 3; width: 100% } }
  #status { color: #fff; font-weight: bold } #score { color: #aaa }
  button { background: none; border: 1px solid #444; color: #ccc; font: inherit; padding: 2px 8px; border-radius: 4px; cursor: pointer }
  canvas { display: block; width: 100%; height: auto; aspect-ratio: ${W} / ${H} }
  footer { padding: 6px 10px; color: #888 } .you { color: #ff5096 } .enemy { color: #3c8cff }
</style></head><body>
<header><span id="status">Connecting…</span><span id="score"></span><button id="full" hidden>Fullscreen</button></header>
<canvas id="map" role="img" aria-label="Live map of your Botters match"></canvas>
<footer><span class="you">● your battalions (number)</span> · <span class="enemy">● enemies in sight (units)</span> · solid ring = held by hand</footer>
<script>(${view})(${JSON.stringify({ W, H })})</script>
</body></html>`
}
