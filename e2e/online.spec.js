import { mkdir } from 'node:fs/promises'
import { test, expect, enterAccount, ageAgentPresence } from './fixtures.js'
import { state } from './preview.js'

test('agent play opens ChatGPT with a prepared prompt and waits for the agent', async ({ page, context, baseURL }) => {
  await enterAccount(page, 'Agent player')
  const pair = await context.request.post(`${baseURL}/agent/pair`,{data:{setup:'ChatGPT'}}).then(r=>r.json())
  await page.goto(pair.approvalUrl)
  await page.locator('#approveAgent').click()
  await expect(page.locator('#pairMessage')).toContainText('Agent connected.')
  await context.route('https://chatgpt.com/**', route => route.fulfill({ status: 200, body: 'intercepted' }))
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('botters.prefs', JSON.stringify({ withAgent: true, assistant: 'ChatGPT' }))
  })
  await page.reload()
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Play with ChatGPT' }).click()
  const popup = await popupPromise
  await popup.waitForURL('https://chatgpt.com/**')
  expect(popup.url()).toContain('https://chatgpt.com/?q=')
  expect(new URL(popup.url()).searchParams.get('q')).toContain('join_match')
  expect(new URL(popup.url()).searchParams.get('q')).toContain(`${(await (await page.request.get('/live-config.json')).json()).url}/mcp`) // the site's own connector (prod: play.botters…)
  await expect(page.locator('#big')).toContainText('Waiting for your agent')
  await expect(page.getByRole('button', { name: 'Start without agent' })).toBeVisible()
})

test('a new player sees agent play after connecting without changing preferences', async ({ page, context, baseURL }) => {
  await enterAccount(page, 'New agent player')
  await page.evaluate(() => localStorage.removeItem('botters.prefs'))
  let granted = false
  await page.route('**/lobby?**', async route => {
    const lobby = await (await route.fetch()).json()
    await route.fulfill({ json: { ...lobby, agent: null, agentGranted: granted } })
  })
  await page.goto('/')
  await expect(page.locator('#agentState')).toContainText('none connected')
  expect(await page.evaluate(() => localStorage.getItem('botters.prefs'))).toBeNull()
  // Saving another setting while disconnected must not save a solo choice.
  await page.locator('#setup > summary').click()
  await page.locator('#minutes [data-v="3"]').click()
  granted = true
  await page.reload()
  await expect(page.locator('#withAgent [data-v="true"]')).toHaveClass('on')
  await expect(page.getByRole('button', { name: 'Play with ChatGPT' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play with Claude' })).toBeVisible()
})

test('an authorized but idle agent still gets the Play with ChatGPT button', async ({ page, context, baseURL }) => {
  await enterAccount(page, 'Idle agent player')
  const pair = await context.request.post(`${baseURL}/agent/pair`, { data: { setup: 'ChatGPT' } }).then(r=>r.json())
  await page.evaluate(async id=>{const token=localStorage.getItem('botters.session');await fetch('/agent/approve?token='+token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})})},pair.id)
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('botters.prefs', JSON.stringify({ withAgent: true, assistant: 'ChatGPT' }))
  })
  await page.reload()
  await ageAgentPresence(page)
  await page.reload()
  await expect(page.locator('#agentState')).toContainText('authorized', { timeout:25000 })
  await expect(page.getByRole('button', { name: 'Play with ChatGPT' })).toBeVisible()
  await expect(page.locator('#play')).toBeHidden()
})
const remote = !!process.env.BOTTERS_SERVER
const endTimeout = remote ? 240000 : 40000
const errors = []
async function enter(page, name) {
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('botters.prefs', JSON.stringify({ minutes: 3, planets: 16, planning: 10, withAgent: false })))
  await page.reload()
  await enterAccount(page, name)
  await expect(page.locator('#quick')).toBeVisible()
}
async function surrender(page) {
  await expect(page.locator('#surrender')).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.locator('#surrender').click()
}
async function ended(page) {
  try { await expect(page.locator('#again')).toBeVisible({ timeout: endTimeout }) }
  catch (e) {
    console.error('End-report diagnostic:', await page.evaluate(async () => {
      const state = await fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json())
      return { options: state.options, startsIn: state.startsIn, tick: state.view?.tick, ended: state.view?.ended, report: !!state.report, error: state.error, connection: document.querySelector('#connection')?.textContent, screen: document.querySelector('#big')?.textContent?.slice(0, 300) }
    }).catch(() => ({ error: 'Could not read final state' })))
    throw e
  }
}

test('delayed input is rejected after a same-session rematch without blocking new input', async ({ page }) => {
  if (process.env.BOTTERS_SERVER || process.env.BOTTERS_LIVE_SERVER) throw new Error('Requires local ephemeral fixtures')
  const inputs = []; let release, intercepted
  const gate = new Promise(r => { release = r }), blocked = new Promise(r => { intercepted = r })
  await page.route('**/input?*', async route => {
    inputs.push(route.request().postDataJSON())
    if (inputs.length === 1) { intercepted(); await gate }
    await route.continue()
  })
  try {
    await enter(page, 'Delayed input'); await page.locator('#play').click()
    await expect(page.locator('#hud')).toContainText('battalions')
    await page.locator('#gambitsBox > summary').click()
    await page.locator('#gambits [data-g]').nth(0).click(); await blocked; await page.locator('#gambits [data-g]').nth(1).click()
    const old = await state(page), token = await page.evaluate(() => localStorage.getItem('botters.session'))
    expect((await page.request.post('/surrender?token=' + token, { data: { matchId: old.matchId } })).status()).toBe(200)
    await expect(page.locator('#again')).toBeVisible(); await page.locator('#again').click()
    await expect(page.locator('#surrender')).toBeVisible()
    const before = await state(page)
    const stale = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/input' && r.request().postDataJSON().toggle === 0)
    await page.locator('#gambits [data-g]').nth(2).click()
    await expect.poll(() => inputs.some(input => input.toggle === 2), { timeout: 3000 }).toBe(true)
    await expect.poll(async () => (await state(page)).view.gambits[2].on).toBe(!before.view.gambits[2].on)
    expect(inputs[0].matchId).toBeTruthy(); expect(inputs[1].matchId).toBe(before.matchId); expect(inputs[0].matchId).not.toBe(before.matchId)
    release(); expect((await stale).status()).toBe(409)
    expect((await state(page)).view.gambits[0].on).toBe(before.view.gambits[0].on)
    expect(inputs.map(({ toggle }) => toggle)).toEqual([0, 2])
  } finally { release() }
})

test('entry remains disabled until its connection settings are ready', async ({ page }) => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/live-config.json', async route => { await gate; await route.continue() })
  try {
    await page.goto('/', { waitUntil: 'commit' })
    await expect(page.locator('#startSolo')).toBeAttached()
    await expect(page.locator('#startSolo')).toBeDisabled({ timeout: 500 })
  } finally { release() }
  await expect(page.locator('#authPanel')).toBeVisible()
})

test('a transient initial WebSocket close reopens the same match and receives frames', async ({ page }) => {
  await enter(page, 'Stream retry')
  await page.evaluate(() => {
    const NativeWebSocket=window.WebSocket
    window.socketAttempts=0
    window.WebSocket=class extends NativeWebSocket { constructor(...args) { super(...args);if(++window.socketAttempts===1)this.addEventListener('open',()=>this.close(),{once:true}) } }
  })
  await page.locator('#play').click()
  await expect.poll(() => page.evaluate(()=>window.socketAttempts), { timeout: 8000 }).toBeGreaterThanOrEqual(2)
  await expect(page.locator('#hud')).toContainText('battalions')
  await expect(page.locator('#connection')).toBeHidden()
})

test('two isolated browsers match, survive disconnect/reload, and see end reports', async ({ page, browser }) => {
  const other = await browser.newContext(), b = await other.newPage()
  try {
    await enter(page, 'Browser <A>'); await enter(b, 'Browser B')
    await page.locator('#quick').click()
    await expect(page.locator('#queueStatus')).toContainText('Finding an opponent')
    await page.locator('#cancel').click()
    await expect(page.locator('#cancel')).toBeHidden()
    await page.locator('#quick').click(); await b.locator('#quick').click()
    await expect(page.locator('#hud')).toBeVisible(); await expect(b.locator('#hud')).toBeVisible()
    await expect(page.locator('#hud')).toContainText('Browser B')
    await expect(b.locator('#hud')).toContainText('Browser <A>')
    const id = (await state(page)).matchId
    await page.context().setOffline(true)
    await expect(page.locator('#connection')).toBeVisible({ timeout: 8000 })
    await page.context().setOffline(false)
    await page.reload()
    await expect(page.locator('#hud')).toBeVisible()
    const resumed = (await state(page)).matchId
    expect(resumed).toBe(id)
    await surrender(page)
    await Promise.all([ended(page), ended(b)])
    expect(errors).toEqual([])
  } finally { await other.close() }
})

test('local server progresses on real time', async ({ page, request, baseURL }) => {
  test.skip(remote, 'Local isolated backend only')
  expect((await request.post(`${baseURL}/__test/advance`, { data: { ms: 1000 } })).status()).not.toBe(200)
  await enter(page, 'Real clock')
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toBeVisible()
  await expect.poll(async () => (await state(page)).view?.tick, { timeout: 20000 }).toBeGreaterThan(0)
})

test('two humans chat in the match journal', async ({ page, browser }) => {
  test.skip(remote, 'Local isolated backend only')
  test.setTimeout(120000)
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } }), b = await other.newPage()
  try {
    await enter(page, 'Chat A'); await enter(b, 'Chat B')
    await page.locator('#quick').click(); await b.locator('#quick').click()
    await expect(page.locator('#msg')).toBeVisible(); await expect(b.locator('#muteChat')).toBeVisible()
    await page.locator('#msg').fill('<b>hi</b>'); await page.locator('#msg').press('Enter')
    await expect(b.locator('#journal')).toContainText('<b>hi</b>', { timeout: 25000 }); await expect(b.locator('#journal div').filter({ hasText: '<b>hi</b>' })).toContainText('Chat A')
    if (process.env.BOTTERS_CHAT_EVIDENCE) { await mkdir(process.env.BOTTERS_CHAT_EVIDENCE, { recursive: true }); await b.screenshot({ path: `${process.env.BOTTERS_CHAT_EVIDENCE}/chat-1280.png` }) }
    await b.setViewportSize({ width: 390, height: 800 })
    for (const selector of ['#msg', '#muteChat']) { const box = await b.locator(selector).boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390) }
    await b.locator('#muteChat').click(); await expect(b.locator('#muteChat')).toHaveAttribute('aria-pressed', 'true')
    await page.locator('#msg').fill('muted secret'); await page.locator('#msg').press('Enter')
    await expect(page.locator('#journal')).toContainText('muted secret')
    await expect(b.locator('#journal')).not.toContainText('muted secret')
  } finally { await other.close() }
})

test('local two-player hand order survives reconnect and opponent plays', async ({ page, browser }) => {
  test.skip(remote, 'Local isolated backend only')
  const other = await browser.newContext(), b = await other.newPage()
  try {
    await enter(page, 'Route A'); await enter(b, 'Route B')
    await page.locator('#quick').click(); await b.locator('#quick').click()
    await expect(page.locator('#hud')).toContainText('Route B')
    await expect(b.locator('#hud')).toContainText('Route A')
    await expect.poll(async () => (await state(page)).startsIn).toBe(0)
    const first = await state(page), second = await state(b)
    expect(first.matchId).toBe(second.matchId)
    const geometry = p => p.evaluate(() => ({ side: document.querySelector('#game').classList.contains('camp-right'), canvas: document.querySelector('#c').getBoundingClientRect().toJSON(), panel: document.querySelector('aside').getBoundingClientRect().toJSON() }))
    const layouts = await Promise.all([geometry(page), geometry(b)])
    expect(layouts.map(l => l.side).sort()).toEqual([false, true])
    for (const l of layouts) expect(l.side ? l.canvas.right <= l.panel.left + 0.1 : l.canvas.left >= l.panel.right - 0.1).toBe(true)
    const order = async p => {
      const row = p.locator('#battalions [data-bat]').first(), id = await row.getAttribute('data-bat')
      await row.click()
      const canvas = p.locator('#c'), box = await canvas.boundingBox()
      const response = p.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/input' && !!r.request().postDataJSON()?.order)
      await canvas.click({ position: { x: box.width - 3, y: box.height - 3 } })
      const sent = await response
      expect(sent.status()).toBe(200); expect(sent.request().postDataJSON().order.bat).toBe(Number(id))
      await expect(p.locator(`#battalions [data-bat="${id}"]`)).toContainText('hand order')
      return id
    }
    const id = await order(page)
    await page.reload(); await expect(page.locator('#hud')).toContainText('Route B')
    expect((await state(page)).matchId).toBe(first.matchId)
    await expect(page.locator(`#battalions [data-bat="${id}"]`)).toContainText('hand order')
    await order(b)
  } finally { await other.close() }
})

test('room link joins, host starts, both finish and rematch in the same room', async ({ page, browser }) => {
  test.setTimeout(remote ? 500000 : 90000)
  const other = await browser.newContext(), b = await other.newPage()
  try {
    await enter(page, 'Room host')
    await page.locator('#createRoom').click()
    await expect(page.locator('#roomPanel')).toBeVisible()
    const code = await page.locator('#roomCode').textContent()
    await enterAccount(b, 'Room guest', `/r/${code}`)
    await expect(page.locator('#roomPlayers')).toContainText('Room guest')
    await expect(b.locator('#roomCode')).toHaveText(code)
    await expect(b.locator('#startRoom')).toBeHidden()
    await page.locator('#startRoom').click()
    await expect(page.locator('#hud')).toBeVisible(); await expect(b.locator('#hud')).toBeVisible()
    await surrender(page)
    await Promise.all([ended(page), ended(b)])
    await page.locator('#again').click()
    await expect(page.locator('#roomReady')).toContainText('1/2 ready')
    await b.locator('#again').click()
    await expect(page.locator('#hud')).toBeVisible(); await expect(b.locator('#hud')).toBeVisible()
    await surrender(b)
    await Promise.all([ended(page), ended(b)])
    await page.locator('#menu').click()
    await expect(page.locator('#roomCode')).toHaveText(code)
    await expect(page.locator('#history tr')).toHaveCount(2)
    expect(errors).toEqual([])
  } finally { await other.close() }
})

test('room surrender reaches both browsers and permits a rematch in the same room', async ({ page, browser }) => {
  test.skip(remote, 'Surrender regression uses isolated local fixtures only')
  const other = await browser.newContext(), b = await other.newPage()
  try {
    await enter(page, 'Surrender host'); await enter(b, 'Surrender guest')
    await page.locator('#createRoom').click()
    await expect(page.locator('#roomPanel')).toBeVisible()
    const code = await page.locator('#roomCode').textContent()
    await b.locator('#joinCode').fill(code); await b.locator('#joinRoom').click()
    await expect(b.locator('#roomCode')).toHaveText(code)
    await expect(page.locator('#roomPlayers')).toContainText('Surrender guest')
    await page.locator('#startRoom').click()
    await expect(page.locator('#surrender')).toBeVisible(); await expect(b.locator('#surrender')).toBeVisible()
    const first = await state(b)
    b.once('dialog', dialog => dialog.dismiss())
    await b.locator('#surrender').click()
    expect((await state(b)).view.ended).toBeNull()
    b.once('dialog', dialog => dialog.accept())
    await b.locator('#surrender').click()
    await expect(b.locator('#big')).toContainText('You surrendered.')
    await expect(page.locator('#big')).toContainText('Your opponent surrendered.')
    expect((await state(b)).report.result).toBe('lost')
    expect((await state(page)).report.result).toBe('won')
    await b.locator('#again').click()
    await expect(b.locator('#roomReady')).toContainText('1/2 ready')
    await page.locator('#again').click()
    await expect(page.locator('#surrender')).toBeVisible(); await expect(b.locator('#surrender')).toBeVisible()
    expect((await state(b)).matchId).not.toBe(first.matchId)
    expect((await state(b)).roomCode).toBe(code)
    expect(errors).toEqual([])
  } finally { await other.close() }
})

test('play again after matchmaking keeps the same two humans instead of starting a house match', async ({ page, browser }) => {
  test.skip(remote, 'Rematch regression uses isolated local fixtures only')
  const other = await browser.newContext(), b = await other.newPage()
  try {
    await enter(page, 'Rematch A'); await enter(b, 'Rematch B')
    await page.locator('#quick').click(); await b.locator('#quick').click()
    await expect(page.locator('#hud')).toContainText('Rematch B')
    await expect(b.locator('#hud')).toContainText('Rematch A')
    const first = await state(page)
    page.once('dialog', dialog => dialog.accept())
    await page.locator('#surrender').click()
    await expect(page.locator('#again')).toBeVisible(); await expect(b.locator('#again')).toBeVisible()
    await page.locator('#again').click()
    await expect(page.locator('#roomPanel')).toBeVisible()
    await expect(page.locator('#roomReady')).toContainText('1/2 ready')
    await expect(page.locator('#roomReady')).toBeInViewport({ ratio: 1 })
    expect((await state(b)).matchId).toBe(first.matchId)
    if (process.env.BOTTERS_SURRENDER_EVIDENCE) await page.screenshot({ path: process.env.BOTTERS_SURRENDER_EVIDENCE + '/pvp-rematch-waiting.png' })
    await b.locator('#again').click()
    await expect(page.locator('#hud')).toContainText('Rematch B')
    await expect(b.locator('#hud')).toContainText('Rematch A')
    await expect(page.locator('#surrender')).toBeVisible(); await expect(b.locator('#surrender')).toBeVisible()
    const aa = await state(page), bb = await state(b)
    expect(aa.matchId).not.toBe(first.matchId); expect(aa.matchId).toBe(bb.matchId)
    expect(aa.roomCode).toBeTruthy(); expect(aa.roomCode).toBe(bb.roomCode)
    expect(aa.opponent.human).toBe(true); expect(bb.opponent.human).toBe(true)
    if (process.env.BOTTERS_SURRENDER_EVIDENCE) await page.screenshot({ path: process.env.BOTTERS_SURRENDER_EVIDENCE + '/pvp-rematch-playing.png' })
    expect(errors).toEqual([])
  } finally { await other.close() }
})

test('invite respects saved solo/opening preferences without disclosing host rules', async ({ page, browser, baseURL }) => {
  await enterAccount(page, 'Host with agent')
  await page.locator('#createRoom').click()
  await expect(page.locator('#roomCode')).toHaveText(/^[A-Z2-9]{6}$/)
  const code = await page.locator('#roomCode').textContent(), opening = [{ if:'always', then:'hold', on:true }]
  const other = await browser.newContext({baseURL}), b = await other.newPage()
  try {
    await b.goto('/')
    await b.evaluate(opening=>localStorage.setItem('botters.prefs',JSON.stringify({withAgent:false,openingMine:true,opening})),opening)
    await enterAccount(b, 'Solo guest', `/r/${code}`)
    await expect(b.locator('#roomCode')).toHaveText(code)
    const shared = await b.evaluate(()=>fetch('/room?token='+localStorage.getItem('botters.session')).then(r=>r.json()))
    expect(shared.settings.opening).toBeUndefined()
    await page.locator('#startRoom').click()
    await expect(b.locator('#hud')).toBeVisible()
    const frame = await state(b)
    expect(frame.me.withAgent).toBe(false)
    expect(frame.view.gambits).toEqual(opening)
  } finally { await other.close() }
})


test('new lobby offers connectors and a queued player can switch to the bot', async ({ page, context }) => {
  await enterAccount(page, 'Queue fallback')
  await expect(page.locator('#connectAgent')).toBeVisible()
  await expect(page.locator('#revokeAgent')).toBeHidden()
  await expect(page.locator('#addClaude')).toHaveAttribute('href', /claude\.ai\/customize\/connectors/)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await context.route('https://chatgpt.com/**', route => route.fulfill({ status: 200, body: 'intercepted' }))
  await page.locator('#addChatGPT').click()
  await expect(page.locator('#connectStatus')).toContainText('Address copied.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL('/mcp', page.url()).href)
  await page.locator('#vs [data-v="hard"]').click()
  let age = false
  await page.route('**/lobby?**', async route => {
    const lobby = await (await route.fetch()).json()
    if (age && lobby.queued) lobby.queuedAt = Date.now() - 16000
    await route.fulfill({ json: lobby })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#quick').click()
  await expect(page.locator('#queueStatus')).toBeInViewport()
  await expect(page.locator('#cancel')).toBeInViewport()
  await expect(page.locator('#queueFallback')).toBeHidden()
  age = true
  await expect(page.locator('#playBotInstead')).toBeInViewport()
  const requests = []
  page.on('request', r => { if (r.method() === 'POST') requests.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }) })
  await page.locator('#playBotInstead').click()
  await expect(page.locator('#hud')).toContainText('battalions', { timeout: 20000 })
  expect(requests.findIndex(r => r.path === '/cancel')).toBeLessThan(requests.findIndex(r => r.path === '/play'))
  expect(requests.find(r => r.path === '/play').body.vs).toBe('hard')
})

test('practice result clears guidance and stays below the HUD on touch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ media: 'screen' })
  await page.addInitScript(() => {
    const native = window.matchMedia
    window.matchMedia = query => query === '(pointer: coarse)' ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : native(query)
  })
  await page.goto('/')
  await expect(page.locator('#practice')).toBeVisible()
  await page.locator('#practice').click()
  await expect(page.locator('#guidePanel')).toBeVisible()
  await expect(page.locator('#selectedBat')).toContainText('Tap a pink ring')
  page.once('dialog', dialog => dialog.accept())
  await page.locator('#surrender').click()
  await expect(page.locator('#again')).toBeVisible()
  await expect(page.locator('#guidePanel')).toBeHidden()
  const hud = await page.locator('#hud').boundingBox(), big = await page.locator('#big').boundingBox()
  expect(big.y).toBeGreaterThanOrEqual(hud.y + hud.height)
})
