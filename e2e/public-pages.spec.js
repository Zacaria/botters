import { test, expect } from './fixtures.js'
import { authorizePreview } from './preview.js'
test.beforeEach(async ({ context }) => authorizePreview(context))

test.use({ javaScriptEnabled: false })

test('public homepage and both policies work without JavaScript or a session', async ({ page }) => {
  const response = await page.goto('/')
  expect(response.status()).toBe(200)
  await expect(page.locator('#start')).toBeVisible()
  await expect(page.getByText('A real-time space strategy game', { exact: false })).toBeVisible()
  const privacy = page.locator('#start a[href="/privacy"]')
  const terms = page.locator('#start a[href="/terms"]')
  await expect(privacy).toBeVisible()
  await expect(terms).toBeVisible()
  await privacy.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Terms of service', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Terms of service', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '← Botters', exact: true }).click()
  await expect(page.locator('#start')).toBeVisible()
})

test('policy routes return their documents and remain readable on a narrow screen', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const [route, heading] of [['privacy', 'Privacy policy'], ['terms', 'Terms of service']]) {
    const response = await page.goto(`/${route}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('link', { name: 'Botters home', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('link', { name: 'Botters home', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`${route}-mobile.png`), fullPage: true })
    const html = await page.request.get(`/${route}.html`)
    expect(html.status()).toBe(200)
    expect(await html.text()).toContain(`<h1>${heading}</h1>`)
  }
})
