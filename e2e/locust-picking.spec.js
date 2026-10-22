import { test, expect } from './fixtures.js'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

if (process.env.BOTTERS_SERVER || process.env.BOTTERS_LIVE_SERVER || process.env.BOTTERS_DEV_CONVEX) throw new Error('Locust picking requires local ephemeral fixtures')
let server, origin

test.beforeAll(async () => {
  const reservation = net.createServer()
  await new Promise(r => reservation.listen(0, '127.0.0.1', r))
  const port = reservation.address().port
  await new Promise(r => reservation.close(r))
  origin = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  await Promise.race([once(server.stderr, 'data'), once(server, 'exit').then(() => { throw new Error('Picking fixture exited before startup') })])
})
test.afterAll(async () => { if (server && server.exitCode === null) { server.kill(); await once(server, 'exit') } })

for (const width of [1440, 390]) for (const otherSelected of [false, true]) test(`locust tail ${width}, ${otherSelected ? 'another swarm selected' : 'unselected'}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
  // Repeatable particle distribution, without replacing game state or input.
  await page.addInitScript(() => {
    let seed = 123456789
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  })
  const errors = [], inputs = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/input') inputs.push(r.postDataJSON()) })
  await page.goto(origin + '/privacy')
  await page.evaluate(() => localStorage.setItem('botters.prefs', JSON.stringify({ vs: 'easy', minutes: 3, planets: 28, openingMine: true, opening: [{ if: 'always', then: 'hold' }] })))
  await page.goto(origin)
  await page.locator('#startName').fill('Locust picking regression')
  await page.locator('#startSolo').click()
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toContainText('swarms')
  const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(0)
  const frame = await read(), swarm = frame.view.swarms.find(s => s.type === 'locust'), other = frame.view.swarms.find(s => s.id !== swarm.id)
  expect(frame.startsIn).toBe(0)
  expect(swarm.manual).toBe(false)
  const radius = 4 + Math.sqrt(swarm.n) * 0.32
  const box = await page.locator('#c').boundingBox(), size = await page.locator('#c').evaluate(c => ({ w: c.width, h: c.height }))
  const point = (x, y) => ({ x: Math.round(box.x + x * box.width / size.w), y: Math.round(box.y + y * box.height / size.h) })
  // Read a bright pink particle in the tail, then target the integer client pixel
  // containing it. This is the visible body, not a guessed empty bounding box.
  const pixel = await page.locator('#c').evaluate((c, { swarm, radius }) => {
    const g = c.getContext('2d'), { data } = g.getImageData(0, 0, c.width, c.height)
    for (let x = Math.floor(swarm.x - 1.7 * radius); x >= Math.ceil(swarm.x - 2.2 * radius); x--) {
      for (let y = Math.ceil(swarm.y - radius * 0.08); y <= Math.floor(swarm.y + radius * 0.08); y++) {
        const i = (y * c.width + x) * 4
        if (data[i] > 180 && data[i + 1] < 100 && data[i + 2] > 90) return { x, y, rgb: [...data.slice(i, i + 3)] }
      }
    }
    return null
  }, { swarm, radius })
  expect(pixel, 'a visible bright tail particle outside the old circle').not.toBeNull()
  const tail = point(pixel.x, pixel.y)
  const actual = { x: (tail.x - box.x) * size.w / box.width, y: (tail.y - box.y) * size.h / box.height }
  expect(Math.hypot(actual.x - swarm.x, actual.y - swarm.y)).toBeGreaterThan(radius + 8)
  if (otherSelected) {
    const centre = point(other.x, other.y)
    await page.mouse.click(centre.x, centre.y)
    await expect(page.locator('#hud')).toContainText(`grabbed: swarm #${other.id}`)
  } else await expect(page.locator('#hud')).not.toContainText('grabbed:')
  await page.screenshot({ path: info.outputPath('before-tail.png') })
  await page.mouse.click(tail.x, tail.y)
  await page.screenshot({ path: info.outputPath('after-tail.png') })
  await info.attach('tail-geometry.json', { body: JSON.stringify({ width, otherSelected, swarm: swarm.id, radius, oldHitRadius: radius + 8, pixel, tail, actual, box }), contentType: 'application/json' })
  await expect.soft(page.locator('#hud')).toContainText(`grabbed: swarm #${swarm.id}`)
  expect.soft(inputs, 'tail selection must not order the previously selected swarm').toEqual([])

  // Positive controls: centre selection and a real, accepted map order still work.
  await page.keyboard.press('Escape')
  const centre = point(swarm.x, swarm.y)
  await page.mouse.click(centre.x, centre.y)
  await expect(page.locator('#hud')).toContainText(`grabbed: swarm #${swarm.id}`)
  const destination = point(600, 350), target = { x: Math.round((destination.x - box.x) * size.w / box.width), y: Math.round((destination.y - box.y) * size.h / box.height) }
  const accepted = page.waitForResponse(r => new URL(r.url()).pathname === '/input' && r.request().method() === 'POST')
  await page.mouse.click(destination.x, destination.y)
  const response = await accepted
  expect(response.status()).toBe(200)
  expect((await response.json()).ok).toBe(true)
  expect(inputs.at(-1).order).toEqual({ swarm: swarm.id, ...target })
  await expect.poll(async () => { const s = (await read()).view.swarms.find(s => s.id === swarm.id); return s && { manual: s.manual, tx: s.tx, ty: s.ty } }).toEqual({ manual: true, tx: target.x, ty: target.y })
  expect(errors).toEqual([])
})
