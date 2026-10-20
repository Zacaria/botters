import { test, expect } from './fixtures.js'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { DEFAULT_GAMBITS } from '../sim.js'

if (process.env.BOTTERS_SERVER || process.env.BOTTERS_LIVE_SERVER || process.env.BOTTERS_DEV_CONVEX) throw new Error('Layout regression requires local ephemeral fixtures')
let server, origin
const custom = [{ if: 'enemy_near', p: 123.5, then: 'retreat', on: false }, { if: 'always', then: 'hold', on: true }]
test.beforeAll(async () => {
  const reservation = net.createServer()
  await new Promise(r => reservation.listen(0, '127.0.0.1', r))
  const port = reservation.address().port
  await new Promise(r => reservation.close(r))
  origin = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  await Promise.race([once(server.stderr, 'data'), once(server, 'exit').then(() => { throw new Error('Layout fixture exited before startup') })])
})
test.afterAll(async () => { if (server && server.exitCode === null) { server.kill(); await once(server, 'exit') } })

for (const width of [390, 1440]) for (const [name, raw, opening] of [
  ['null opening', '{"opening":null}', DEFAULT_GAMBITS],
  ['truncated JSON', '{"vs":', DEFAULT_GAMBITS],
  ['disabled parameter', JSON.stringify({ openingMine: true, opening: custom }), custom],
]) test(`layout ${width} ${name}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
  const errors = [], posts = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname) })
  await page.goto(origin + '/privacy')
  await page.evaluate(raw => localStorage.setItem('botters.prefs', raw), raw)
  await page.goto(origin)
  await page.locator('#startName').fill('Layout recovery')
  await page.locator('#startSolo').click()
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toContainText('swarms')
  const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(0)
  const first = await read(), session = await page.evaluate(() => localStorage.getItem('botters.session'))
  const map = f => f.view.planets.map(({ id, x, y, r }) => ({ id, x, y, r }))
  expect(first.view.gambits).toEqual(opening)
  async function visibleMap(label) {
    await page.screenshot({ path: info.outputPath(label + '.png') })
    const box = await page.locator('#c').boundingBox(), aside = await page.locator('aside').boundingBox()
    await info.attach(label + '-geometry.json', { body: JSON.stringify({ box, aside }), contentType: 'application/json' })
    expect(box.width).toBeGreaterThan(300); expect(box.height).toBeGreaterThan(170)
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.1)
    expect(box.y + box.height).toBeLessThanOrEqual(width === 390 ? 844 : 900)
    expect(box.x + box.width <= aside.x + 0.1 || box.y + box.height <= aside.y + 0.1).toBe(true)
    expect(await page.locator('#c').evaluate(c => { const r = c.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === c })).toBe(true)
    if (width === 1440) { expect(aside.x).toBe(1040); expect(aside.width).toBe(400); expect(box.width).toBe(1040) }
    return box
  }
  async function pointerOrder() {
    const box = await page.locator('#c').boundingBox(), size = await page.locator('#c').evaluate(c => ({ w: c.width, h: c.height }))
    const frame = await read(), swarm = frame.view.swarms[0]
    const point = (x, y) => ({ x: box.x + x * box.width / size.w, y: box.y + y * box.height / size.h })
    const s = point(swarm.x, swarm.y)
    await page.mouse.click(s.x, s.y)
    await expect(page.locator('#hud')).toContainText(`grabbed: swarm #${swarm.id}`)
    // Chromium dispatches integer client coordinates; invert those actual pixels.
    const p = point(600, 350)
    p.x = Math.round(p.x); p.y = Math.round(p.y)
    const target = { x: Math.round((p.x - box.x) * size.w / box.width), y: Math.round((p.y - box.y) * size.h / box.height) }
    await page.mouse.click(p.x, p.y)
    await expect.poll(async () => { const s = (await read()).view.swarms.find(s => s.id === swarm.id); return s && { manual: s.manual, tx: s.tx, ty: s.ty } }).toEqual({ manual: true, tx: target.x, ty: target.y })
    await info.attach('pointer-order.json', { body: JSON.stringify({ swarm: swarm.id, client: p, target }), contentType: 'application/json' })
  }
  await visibleMap('before-order')
  await pointerOrder()
  await page.locator('#editG').click()
  await expect(page.locator('#gEditor .ed')).toHaveCount(opening.length)
  await page.locator('#cancelG').click()
  await page.locator('#leave').scrollIntoViewIfNeeded()
  await expect(page.locator('#leave')).toBeInViewport()
  const postsBefore = [...posts]
  await page.reload()
  await expect(page.locator('#hud')).toContainText('swarms')
  await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(first.view.tick)
  expect(map(await read())).toEqual(map(first))
  expect((await read()).view.gambits).toEqual(opening)
  expect(await page.evaluate(() => localStorage.getItem('botters.session'))).toBe(session)
  expect(await page.evaluate(() => localStorage.getItem('botters.prefs'))).toBe(raw)
  expect(posts).toEqual(postsBefore)
  expect(posts.filter(p => p === '/session')).toHaveLength(1)
  expect(posts.filter(p => p === '/play')).toHaveLength(1)
  await visibleMap('after-reload')
  await pointerOrder()
  await page.screenshot({ path: info.outputPath('after-reload-order.png') })
  expect(errors).toEqual([])
})
