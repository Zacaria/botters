import { test, expect } from './fixtures.js'

// Removing the static paths/transcript, clipping the page or moving them behind
// bootAccount must break this test even when the application cannot execute JS.
test.describe('public explanation without JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  test('Play and Understand remain navigable with transcript, guide and policies', async ({ page }) => {
    expect((await page.goto('/')).status()).toBe(200)
    await page.getByRole('link', { name: 'Understand the game', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'You set the strategy. Swarms follow the rules.', exact: true })).toBeInViewport()
    await expect(page.locator('#understand')).toContainText('first matching rule')
    await expect(page.locator('#understand')).toContainText('Most particles')
    await expect(page.locator('#demo-video')).toHaveAttribute('controls', '')
    await page.getByText('Read the video transcript', { exact: true }).click()
    await expect(page.locator('#demo-transcript')).toBeVisible()
    await expect(page.locator('#demo-transcript')).toContainText('automated')
    await expect(page.locator('#demo-transcript')).toContainText('fixed gambits')
    await expect(page.locator('#demo-transcript')).toContainText('no model')
    expect(await page.locator('#start').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.getByRole('link', { name: 'Play Botters', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Play with your agent', exact: true })).toBeInViewport()
    // Playwright's text matcher skips NOSCRIPT descendants; inspect the visible
    // paragraph directly (the browser accessibility snapshot includes it).
    await expect(page.locator('#play-entry noscript p')).toBeVisible()
    expect(await page.locator('#play-entry noscript p').evaluate(el => el.textContent)).toContain('JavaScript is needed to play')
    await page.locator('#understand a[href="/guide"]').click()
    await expect(page.locator('h1')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.goto('/')
    for (const [path, heading] of [['privacy', 'Privacy policy'], ['terms', 'Terms of service']]) {
      await page.locator(`#start a[href="/${path}"]`).click()
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByRole('link', { name: '← Botters', exact: true }).click()
    }
  })
})

// Historical R1 remains in Git/evidence. New film surfaces must be checked on
// the new bytes; a prior PASS cannot be transferred. This checks served text
// and active browser cues; visual truth still requires exact-candidate review.
test('French trailer surfaces describe conquest, manual travel and return to gambits', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('#demo-description')).toContainText('bande-annonce')
  await expect(page.locator('#demo-description')).not.toContainText('Silent gameplay')
  await page.getByText('Read the video transcript', { exact: true }).click()
  const transcript = page.locator('#demo-transcript')
  await expect(transcript).toContainText('Capturez des planètes')
  await expect(transcript).toContainText('Reprenez la main')
  await expect(transcript).toContainText('217')
  await expect(transcript).toContainText('retour aux gambits')
  await expect(page.locator('#demo-music-credit')).toContainText("'Resonance' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au")
  const video = page.locator('#demo-video')
  await video.scrollIntoViewIfNeeded()
  await video.focus()
  await page.keyboard.press('Space')
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(0.5)
  await page.keyboard.press('Space')
  await video.evaluate(v => { v.textTracks[0].mode = 'hidden' })
  await expect.poll(() => video.evaluate(v => v.textTracks[0].cues?.length)).toBe(13)
  await video.evaluate(v => { v.currentTime = 39 })
  await expect.poll(() => video.evaluate(v => v.seeking)).toBe(false)
  const active = () => video.evaluate(v => [...v.textTracks[0].activeCues].map(c => c.text).join(' '))
  await expect.poll(active).toMatch(/Reprenez la main/)
  await page.screenshot({ path: testInfo.outputPath('trailer-manual-39s.png'), fullPage: true })
  await video.evaluate(v => { v.currentTime = 47.5 })
  await expect.poll(() => video.evaluate(v => v.seeking)).toBe(false)
  await expect.poll(active).toMatch(/retour aux gambits/)
  await page.screenshot({ path: testInfo.outputPath('trailer-release-47s.png'), fullPage: true })
})

// Wrong asset path, MIME/ranges, unsupported codec, broken native controls or
// autoplay all fail through the real browser, not a mocked video component.
test('native demo decodes, plays, pauses and seeks by keyboard without login', async ({ page, request }, testInfo) => {
  const errors = [], requested = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', r => requested.push(new URL(r.url()).pathname))
  await page.goto('/')
  const video = page.locator('#demo-video')
  await expect(video).toHaveAttribute('preload', 'none')
  await expect(video).not.toHaveAttribute('autoplay', '')
  expect(await video.evaluate(v => v.paused)).toBe(true)
  expect(requested).not.toContain('/media/public-demo.webm')
  await video.scrollIntoViewIfNeeded()
  await video.focus()
  await expect(video).toBeFocused()
  await page.keyboard.press('Space')
  await expect.poll(() => video.evaluate(v => v.currentTime), { timeout: 15000 }).toBeGreaterThan(0.5)
  expect(await video.evaluate(v => v.videoWidth)).toBe(1920)
  expect(await video.evaluate(v => v.videoHeight)).toBe(1080)
  expect(await video.evaluate(v => v.duration)).toBeCloseTo(60, 0)
  await page.keyboard.press('Space')
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(true)
  const before = await video.evaluate(v => v.currentTime)
  await page.keyboard.press('ArrowRight')
  // Chromium's native range control steps by 1% of this 60s film (0.6s),
  // not an assumed five-second player shortcut. It must seek while paused.
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(before + 0.1)
  expect(await video.evaluate(v => v.paused)).toBe(true)
  await page.keyboard.press('Space')
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(false)
  await page.keyboard.press('Space')
  await video.evaluate(v => { v.textTracks[0].mode = 'hidden' })
  await expect.poll(() => video.evaluate(v => v.textTracks[0].cues?.length)).toBe(13)
  await page.screenshot({ path: testInfo.outputPath('native-demo.png'), fullPage: true })
  for (const [path, type] of [['public-demo.webm', 'video/webm'], ['public-demo-poster.jpg', 'image/jpeg'], ['public-demo.vtt', 'text/vtt']]) {
    const response = await request.get(`/media/${path}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain(type)
  }
  const partial = await request.get('/media/public-demo.webm', { headers: { Range: 'bytes=10-29' } })
  expect(partial.status()).toBe(206)
  expect((await partial.body()).length).toBe(20)
  expect((await request.get('/media/not-public.json')).status()).toBe(404)
  expect(errors).toEqual([])
})
