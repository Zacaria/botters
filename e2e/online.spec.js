import { test, expect } from '@playwright/test'
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
async function ended(page) { await expect(page.locator('#again')).toBeVisible({ timeout: endTimeout }) }

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
    const id = await page.evaluate(async () => (await fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json())).matchId)
    await page.context().setOffline(true)
    await expect(page.locator('#connection')).toBeVisible({ timeout: 8000 })
    await page.context().setOffline(false)
    await page.reload()
    await expect(page.locator('#hud')).toBeVisible()
    const resumed = await page.evaluate(async () => (await fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json())).matchId)
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

test('invite respects saved solo/opening preferences without disclosing host rules', async ({ page, browser, request }) => {
  const host = await request.post('/session', { data: { name: 'Host with agent', setup: 'codex' } }).then(r => r.json())
  const guest = await request.post('/session', { data: { name: 'Solo guest', setup: 'claude' } }).then(r => r.json())
  const opening = [{ if: 'always', then: 'hold' }]
  const room = await request.post(`/rooms?token=${host.humanToken}`, { data: { minutes: 3, planets: 16, opening } }).then(r => r.json())
  const other = await browser.newContext(), b = await other.newPage()
  try {
    await other.addInitScript(({ token, opening }) => { localStorage.setItem('botters.session', token); localStorage.setItem('botters.prefs', JSON.stringify({ withAgent: false, openingMine: true, opening })) }, { token: guest.humanToken, opening })
    await b.goto(`/r/${room.code}`)
    await expect(b.locator('#roomCode')).toHaveText(room.code)
    const shared = await request.get(`/room?token=${guest.humanToken}`).then(r => r.json())
    expect(shared.settings.opening).toBeUndefined()
    await page.goto(`/?s=${host.humanToken}`)
    await page.locator('#startRoom').click()
    await expect(b.locator('#hud')).toBeVisible()
    const state = await request.get(`/state?token=${guest.humanToken}`).then(r => r.json())
    expect(state.me.withAgent).toBe(false)
    expect(state.view.gambits).toEqual([{ ...opening[0], on: true }])
  } finally { await other.close() }
})
