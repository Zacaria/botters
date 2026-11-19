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
  expect(new URL(popup.url()).searchParams.get('q')).toContain('https://play.botters.havesomecode.io/mcp')
  await expect(page.locator('#big')).toContainText('waiting for your agent…')
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
    await expect(page.locator('#hud')).toContainText('swarms')
    await page.keyboard.press('1'); await blocked; await page.keyboard.press('2')
    page.once('dialog', dialog => dialog.accept()); await page.locator('#surrender').click()
    await expect(page.locator('#again')).toBeVisible(); await page.locator('#again').click()
    await expect(page.locator('#surrender')).toBeVisible()
    const before = await state(page)
    const stale = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/input' && r.request().postDataJSON().toggle === 0)
    await page.keyboard.press('3')
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
  await expect(page.locator('#hud')).toContainText('swarms')
  await expect(page.locator('#connection')).toBeHidden()
})

test('two isolated browsers match, survive disconnect/reload, and see end reports', async ({ page, browser }) => {
  const other = await browser.newContext(), b = await other.newPage()
  try {
    await enter(page, 'Browser <A>'); await enter(b, 'Browser B')
    await page.locator('#quick').click()
    await expect(page.locator('#lobbyMsg')).toContainText('Finding an opponent')
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
    await Promise.all([ended(page), ended(b)])
    await expect(page.locator('#big')).toContainText('Same match replayed')
    await expect(b.locator('#big')).toContainText('Same match replayed')
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

test('local two-player manual route survives reconnect and opponent plays', async ({ page, browser }) => {
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
    await page.bringToFront(); await page.keyboard.press('Tab')
    await expect(page.locator('#hud')).toContainText('grabbed: swarm #')
    const swarm = Number((await page.locator('#hud').textContent()).match(/grabbed: swarm #(\d+)/)[1])
    const box = await page.locator('#c').boundingBox()
    const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/input' && !!r.request().postDataJSON()?.route)
    await page.keyboard.down('Shift')
    await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4); await page.mouse.down()
    await page.mouse.move(box.x + box.width * .6, box.y + box.height * .4); await page.mouse.up()
    await page.keyboard.up('Shift')
    const sent = await response, route = sent.request().postDataJSON().route
    expect(sent.status()).toBe(200); expect(route.swarm).toBe(swarm)
    await expect.poll(async () => (await state(page)).feed.some(f => f.text.includes(`routed swarm ${swarm} through`))).toBe(true)
    await page.reload(); await expect(page.locator('#hud')).toContainText('Route B')
    expect((await state(page)).matchId).toBe(first.matchId)
    await b.bringToFront(); await b.keyboard.press('Tab')
    await expect(b.locator('#hud')).toContainText('grabbed: swarm #')
    const bBox = await b.locator('#c').boundingBox()
    const orderResponse = b.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/input' && !!r.request().postDataJSON()?.order)
    await b.mouse.click(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2)
    expect((await orderResponse).status()).toBe(200)
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
    await Promise.all([ended(page), ended(b)])
    await page.locator('#again').click()
    await expect(page.locator('#roomReady')).toContainText('1/2 ready')
    await b.locator('#again').click()
    await expect(page.locator('#hud')).toBeVisible(); await expect(b.locator('#hud')).toBeVisible()
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
    await expect(b.locator('#big')).toContainText('you surrendered')
    await expect(page.locator('#big')).toContainText('opponent surrendered')
    expect((await state(b)).report.actual.result).toBe('lost')
    expect((await state(page)).report.actual.result).toBe('won')
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
