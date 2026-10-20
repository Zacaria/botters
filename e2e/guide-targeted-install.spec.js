import { test, expect } from './fixtures.js'

// These literals are the public installer contract, not derived from guide DOM.
const clients = [
  ['Claude Code', 'npx -y github:Zacaria/botters#pvp-online install --client claude'],
  ['Codex', 'npx -y github:Zacaria/botters#pvp-online install --client codex'],
  ['Claude Desktop', 'npx -y github:Zacaria/botters#pvp-online install --client desktop'],
  ['Cursor', 'npx -y github:Zacaria/botters#pvp-online install --client cursor'],
  ['Windsurf', 'npx -y github:Zacaria/botters#pvp-online install --client windsurf'],
]
const viewports = [{ width: 390, height: 844 }, { width: 1440, height: 900 }]

// Real Tab traversal, rather than focus()/click(), catches unreachable controls.
async function tabTo(page, locator) {
  for (let i = 0; i < 40; i++) {
    if (await locator.evaluate(el => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(locator).toBeFocused()
}

async function localSetup(page) {
  expect((await page.goto('/guide')).status()).toBe(200)
  const link = page.getByRole('link', { name: 'Local client', exact: true })
  await tabTo(page, link)
  await page.keyboard.press('Enter')
  await expect(page.locator('#local-title')).toBeInViewport()
}

async function openClient(page, name) {
  const summary = page.locator('#local-client summary').filter({ hasText: new RegExp(`^${name}$`) })
  await expect(summary, `missing targeted installation disclosure for ${name}`).toBeVisible()
  await tabTo(page, summary)
  await page.keyboard.press('Enter')
  const details = summary.locator('..')
  await expect(details).toHaveAttribute('open', '')
  return { summary, pre: details.locator('pre') }
}

async function selectCommand(pre, command) {
  await expect(pre).toBeVisible()
  expect(await pre.evaluate(el => getComputedStyle(el).userSelect)).not.toBe('none')
  // Browser automation selects the real text node, also in a no-script context.
  expect(await pre.evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el.firstChild)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString()
  })).toBe(command)
}

async function closeClient(page, summary) {
  // The copy button directly follows its summary in the native tab order.
  if (!await summary.evaluate(el => el === document.activeElement)) await page.keyboard.press('Shift+Tab')
  await expect(summary).toBeFocused()
  await page.keyboard.press('Enter')
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const errors = [], unexpected = []
  const origin = new URL(baseURL).origin
  page.on('pageerror', error => errors.push(error.message))
  // Fail closed: no guide interaction can reach an account or remote backend.
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || request.method() !== 'GET' || !['/guide', '/favicon.ico'].includes(url.pathname)) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort()
    }
    return route.continue()
  })
  page.__guideErrors = errors
  page.__guideUnexpected = unexpected
})

test.afterEach(async ({ page, context }) => {
  expect(page.__guideErrors).toEqual([])
  expect(page.__guideUnexpected).toEqual([])
  expect(await context.cookies()).toEqual([])
})

for (const viewport of viewports) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    // Removing a target or copying labels/neighbor commands must break this.
    test('keyboard discovers five targets and copy writes only the chosen command', async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        window.guideWrites = []
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          writeText: async text => { window.guideWrites.push(text) },
        } })
      })
      await localSetup(page)
      const copied = []
      for (const [name, command] of clients) {
        const { summary, pre } = await openClient(page, name)
        await expect(pre).toContainText(command)
        const copy = pre.getByRole('button')
        await expect(copy).toHaveText('copy')
        await page.keyboard.press('Tab')
        await expect(copy).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(copy).toHaveText('copied')
        copied.push(command)
        // Capture only what the unchanged production handler actually writes.
        expect(await page.evaluate(() => window.guideWrites)).toEqual(copied)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await selectCommand(pre, command)
        await page.screenshot({ path: testInfo.outputPath(`target-${name.replaceAll(' ', '-')}.png`) })
        await closeClient(page, summary)
      }
      await expect(page.locator('#copy-status')).toBeEmpty()
    })

    for (const mode of ['absent', 'refused']) {
      test(`clipboard ${mode} keeps every command selectable with manual-copy status`, async ({ page }) => {
        await page.addInitScript(mode => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'absent' ? undefined : {
            writeText: async () => { throw new DOMException('Denied for test', 'NotAllowedError') },
          } })
        }, mode)
        await localSetup(page)
        for (const [name, command] of clients) {
          const { summary, pre } = await openClient(page, name)
          await page.keyboard.press('Tab')
          const copy = pre.getByRole('button')
          await expect(copy).toHaveText('copy')
          await expect(copy).toBeFocused()
          await page.keyboard.press('Enter')
          await expect(page.locator('#copy-status')).toHaveText('Copy unavailable. Select the command text and copy it manually.')
          await expect(copy).toHaveText('copy')
          await selectCommand(pre, command)
          await closeClient(page, summary)
        }
      })
    }

    test.describe('without JavaScript', () => {
      test.use({ javaScriptEnabled: false })
      // Hiding content behind a JS chooser or clipping long commands breaks this.
      test('all five commands open by keyboard and remain selectable without horizontal overflow', async ({ page }, testInfo) => {
        await localSetup(page)
        for (const [name, command] of clients) {
          const { summary, pre } = await openClient(page, name)
          await expect(pre).toHaveText(command)
          await expect(pre.getByRole('button')).toHaveCount(0)
          await selectCommand(pre, command)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          expect(await pre.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
          await page.screenshot({ path: testInfo.outputPath(`no-js-${name.replaceAll(' ', '-')}.png`) })
          await closeClient(page, summary)
        }
      })
    })
  })
}

// One real OS/browser clipboard check supplements deterministic boundary capture.
test('native browser clipboard receives all five keyboard copies', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await localSetup(page)
  for (const [name, command] of clients) {
    const { summary, pre } = await openClient(page, name)
    await page.keyboard.press('Tab')
    const copy = pre.getByRole('button')
    await expect(copy).toHaveText('copy')
    await expect(copy).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(copy).toHaveText('copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command)
    await closeClient(page, summary)
  }
})

test('global setup, manual fallbacks and truthful connection paths remain usable', async ({ page }) => {
  await localSetup(page)
  const local = page.locator('#local-client')
  await expect(local).toContainText('--client limits configuration to this client only')
  await expect(local).toContainText('Without --client, all detected clients are targeted')
  await expect(local).toContainText('If your selected client is not detected, the installer reports an error without installing it or switching to another client')
  await expect(local.getByRole('heading', { name: 'All detected clients', exact: true })).toBeVisible()
  const global = local.locator('pre').filter({ hasText: /^npx -y github:Zacaria\/botters install/ })
  expect(await global.evaluate(el => el.firstChild.textContent)).toBe('npx -y github:Zacaria/botters install')
  await expect(local).toContainText('Node.js 22 or newer')
  await expect(local).toContainText('asks before writing')
  await expect(local).toContainText('Restart your agent')
  const fallback = page.locator('summary').filter({ hasText: /^Manual setup fallback$/ })
  await tabTo(page, fallback)
  await page.keyboard.press('Enter')
  await expect(fallback.locator('..')).toContainText('claude mcp add --scope user botters')
  await expect(fallback.locator('..')).toContainText('codex mcp add botters')
  await expect(fallback.locator('..')).toContainText('"mcpServers"')
  await page.keyboard.press('Enter')
  for (const [link, section, text] of [
    ['Web interface', '#web-client', 'do not paste the install command into a web chat'],
    ['Phone', '#phone', 'does not establish touch-gameplay support'],
  ]) {
    await tabTo(page, page.getByRole('link', { name: link, exact: true }))
    await page.keyboard.press('Enter')
    await expect(page.locator(section)).toBeInViewport()
    await expect(page.locator(section)).toContainText(text)
    const back = page.locator(`${section} a[href="#local-client"]`)
    await tabTo(page, back)
    await page.keyboard.press('Enter')
    await expect(page.locator('#local-title')).toBeInViewport()
  }
})
