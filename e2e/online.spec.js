import { test, expect } from './fixtures.js'
import { authorizePreview, liveURL, state } from './preview.js'
test.beforeEach(async ({ context }) => authorizePreview(context))

test('agent play opens ChatGPT with a prepared prompt and waits for the agent', async ({ page, context, baseURL }) => {
  const session = await (await context.request.post(`${baseURL}/session`, { data: { name: 'Agent player', setup: 'ChatGPT' } })).json()
  await context.route('https://chatgpt.com/**', route => route.fulfill({ status: 200, body: 'intercepted' }))
  await page.goto('/')
  await page.evaluate(token => {
    localStorage.setItem('botters.session', token)
    localStorage.setItem('botters.prefs', JSON.stringify({ withAgent: true, assistant: 'ChatGPT' }))
  }, session.humanToken)
  await page.reload()
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Play with ChatGPT' }).click()
  const popup = await popupPromise
  await popup.waitForURL('https://chatgpt.com/**')
  expect(popup.url()).toContain('https://chatgpt.com/?q=')
  expect(new URL(popup.url()).searchParams.get('q')).toContain('join_match')
  await expect(page.locator('#big')).toContainText('waiting for your agent…')
  await expect(page.getByRole('button', { name: 'Start without agent' })).toBeVisible()
})
const remote = !!process.env.BOTTERS_SERVER
const endTimeout = remote ? 240000 : 40000
const errors = []
async function enter(page, name) {
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('botters.prefs', JSON.stringify({ minutes: 3, planets: 16, planning: 10, withAgent: false })))
  await page.reload()
  await page.locator('#startName').fill(name)
  await page.locator('#startSolo').click()
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

test('entry remains disabled until its connection settings are ready', async ({ page }) => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/live-config.json', async route => { await gate; await route.continue() })
  try {
    await page.goto('/', { waitUntil: 'commit' })
    await expect(page.locator('#startSolo')).toBeAttached()
    await expect(page.locator('#startSolo')).toBeDisabled({ timeout: 500 })
  } finally { release() }
  await expect(page.locator('#startSolo')).toBeEnabled()
})

test('a transient initial stream 503 reopens the same match and receives frames', async ({ page }) => {
  await enter(page, 'Stream retry')
  let attempts = 0
  await page.route('**/socket?**', route => ++attempts === 1 ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Retry shortly."}' }) : route.continue())
  await page.locator('#play').click()
  await expect.poll(() => attempts, { timeout: 8000 }).toBeGreaterThanOrEqual(2)
  await expect(page.locator('#hud')).toContainText('swarms')
  await expect(page.locator('#connection')).toBeHidden()
})

test('two isolated browsers match, survive disconnect/reload, and see end reports', async ({ page, browser }) => {
  const other = await browser.newContext(), b = await other.newPage()
  await authorizePreview(other)
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

test('room link joins, host starts, both finish and rematch in the same room', async ({ page, browser }) => {
  test.setTimeout(remote ? 500000 : 90000)
  const other = await browser.newContext(), b = await other.newPage()
  await authorizePreview(other)
  try {
    await enter(page, 'Room host')
    await page.locator('#createRoom').click()
    await expect(page.locator('#roomPanel')).toBeVisible()
    const code = await page.locator('#roomCode').textContent()
    await b.goto(`/r/${code}`)
    await b.locator('#startName').fill('Room guest'); await b.locator('#startSolo').click()
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

test('invite respects saved solo/opening preferences without disclosing host rules', async ({ page, browser, request }) => {
  const host = await request.post(liveURL + '/session', { data: { name: 'Host with agent', setup: 'codex' } }).then(r => r.json())
  const guest = await request.post(liveURL + '/session', { data: { name: 'Solo guest', setup: 'claude' } }).then(r => r.json())
  const opening = [{ if: 'always', then: 'hold' }]
  const room = await request.post(`${liveURL}/rooms?token=${host.humanToken}`, { data: { minutes: 3, planets: 16, opening } }).then(r => r.json())
  const other = await browser.newContext(), b = await other.newPage()
  await authorizePreview(other)
  try {
    await other.addInitScript(({ token, opening }) => { localStorage.setItem('botters.session', token); localStorage.setItem('botters.prefs', JSON.stringify({ withAgent: false, openingMine: true, opening })) }, { token: guest.humanToken, opening })
    await b.goto(`/r/${room.code}`)
    await expect(b.locator('#roomCode')).toHaveText(room.code)
    const shared = await request.get(`${liveURL}/room?token=${guest.humanToken}`).then(r => r.json())
    expect(shared.settings.opening).toBeUndefined()
    await page.goto(`/?s=${host.humanToken}`)
    await page.locator('#startRoom').click()
    await expect(b.locator('#hud')).toBeVisible()
    const state = await request.get(`${liveURL}/state?token=${guest.humanToken}`).then(r => r.json())
    expect(state.me.withAgent).toBe(false)
    expect(state.view.gambits).toEqual([{ ...opening[0], on: true }])
  } finally { await other.close() }
})
