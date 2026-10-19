import { test, expect } from '@playwright/test'

test('guide leads with one copyable command and keeps client snippets in a collapsed fallback', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/guide')
  const command = page.locator('pre').first()
  await expect(command).toHaveText('npx -y github:Zacaria/botters installcopy')
  await command.getByRole('button', { name: 'copy', exact: true }).click()
  await expect(command.getByRole('button')).toHaveText('copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npx -y github:Zacaria/botters install')
  await expect(page.locator('details')).not.toHaveAttribute('open')
  await expect(page.locator('details pre').first()).not.toBeVisible()
  await page.getByText('Manual setup fallback', { exact: true }).click()
  await expect(page.locator('details pre').first()).toBeVisible()
  await expect(page.locator('details')).toContainText('default_tools_approval_mode = "approve"')
  for (const text of ['backs up existing configuration', 'approves Botters tools automatically', 'Restart your agent', 'install --uninstall']) await expect(page.locator('main')).toContainText(text)
})

test('guide setup works without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
  try {
    const page = await context.newPage()
    await page.goto('/guide')
    await expect(page.locator('pre').first()).toHaveText('npx -y github:Zacaria/botters install')
    await page.getByText('Manual setup fallback', { exact: true }).click()
    await expect(page.locator('details pre').first()).toBeVisible()
  } finally { await context.close() }
})

for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const javaScriptEnabled of [true, false]) {
    test(`guide routes and expanded content fit ${viewport.width}px with JavaScript ${javaScriptEnabled}`, async ({ browser, baseURL }, testInfo) => {
      const context = await browser.newContext({ baseURL, viewport, javaScriptEnabled, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 })
      try {
        const page = await context.newPage()
        await page.goto('/guide')
        const geometry = async label => {
          const sizes = await page.evaluate(() => ({
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth,
            blocks: [...document.querySelectorAll('main, nav, section, pre, table, td, summary, button, a')].filter(el => el.checkVisibility()).map(el => {
              const rect = el.getBoundingClientRect()
              return { tag: el.tagName, text: el.textContent.slice(0, 70), left: rect.left, right: rect.right, width: el.clientWidth, scroll: el.scrollWidth }
            }),
          }))
          await testInfo.attach(label, { body: JSON.stringify(sizes, null, 2), contentType: 'application/json' })
          expect(sizes.viewport).toBe(viewport.width)
          expect(sizes.document).toBeLessThanOrEqual(viewport.width)
          for (const block of sizes.blocks) {
            expect(block.left, `${block.tag}: ${block.text}`).toBeGreaterThanOrEqual(0)
            expect(block.right, `${block.tag}: ${block.text}`).toBeLessThanOrEqual(viewport.width + 1)
            expect(block.scroll, `${block.tag}: ${block.text}`).toBeLessThanOrEqual(block.width + 1)
          }
        }
        await geometry('collapsed-geometry')
        const paths = page.getByRole('navigation', { name: 'Connection paths' })
        await expect(paths.getByRole('link')).toHaveCount(3)
        if (!javaScriptEnabled) await page.screenshot({ path: testInfo.outputPath(`chooser-${viewport.width}.png`) })
        for (const [name, id] of [['Local client', 'local-client'], ['Web interface', 'web-client'], ['Phone', 'phone']]) {
          await paths.getByRole('link', { name, exact: true }).click()
          await expect(page).toHaveURL(new RegExp(`#${id}$`))
          await expect(page.locator(`#${id}`)).toBeInViewport()
        }
        for (const id of ['web-client', 'phone']) {
          const route = page.locator(`#${id}`)
          await expect(route).toContainText('does not demonstrate a direct MCP connection')
          await route.getByRole('link', { name: 'Go to local client setup' }).click()
          await expect(page).toHaveURL(/#local-client$/)
        }
        const local = page.locator('#local-client')
        if (!javaScriptEnabled) await page.screenshot({ path: testInfo.outputPath(`local-${viewport.width}.png`) })
        for (const client of ['Claude Code', 'Codex', 'Claude Desktop', 'Cursor', 'Windsurf']) await expect(local).toContainText(client)
        for (const text of ['Node.js 22', 'Restart your agent', 'Connect agent', 'Disconnect agent', 'seven days', 'ten minutes']) await expect(page.locator('main')).toContainText(text)
        const command = page.locator('pre').first()
        await expect(command).toContainText('npx -y github:Zacaria/botters install')
        expect(await page.locator('pre').evaluateAll(els => els.filter(el => el.firstChild.textContent === 'npx -y github:Zacaria/botters install').length)).toBe(1)
        await expect(page.locator('details')).not.toHaveAttribute('open')
        await page.getByText('Manual setup fallback', { exact: true }).click()
        await expect(page.locator('details pre').first()).toBeVisible()
        await geometry('expanded-geometry')
        await page.getByRole('link', { name: 'Privacy policy' }).click()
        await expect(page).toHaveURL(/\/privacy$/)
        await page.goto('/guide')
        await page.getByRole('link', { name: 'Terms of service' }).click()
        await expect(page).toHaveURL(/\/terms$/)
        await page.goto('/guide')
        await page.getByRole('link', { name: '← back to the game' }).click()
        await expect(page).toHaveURL(`${baseURL}/`)
      } finally { await context.close() }
    })
  }
}

test('guide paths and manual fallback work with the keyboard without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 320, height: 640 } })
  try {
    const page = await context.newPage()
    await page.goto('/guide')
    const paths = page.getByRole('navigation', { name: 'Connection paths' })
    await paths.getByRole('link', { name: 'Local client', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(paths.getByRole('link', { name: 'Web interface', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#web-client$/)
    await page.locator('#web-client').getByRole('link', { name: 'Go to local client setup' }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#local-client$/)
    const summary = page.locator('summary')
    await summary.focus(); await page.keyboard.press('Enter')
    await expect(page.locator('details')).toHaveAttribute('open', '')
    await expect(page.locator('details pre').first()).toBeVisible()
    await page.keyboard.press('Space')
    await expect(page.locator('details')).not.toHaveAttribute('open')
  } finally { await context.close() }
})

for (const clipboard of ['denied', 'unavailable']) {
  test(`guide preserves selectable command when clipboard is ${clipboard}`, async ({ page }) => {
    // Exercise browser API failure, not a simulated game/model or server response.
    await page.addInitScript(mode => Object.defineProperty(navigator, 'clipboard', { value: mode === 'denied' ? { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } : undefined }), clipboard)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/guide')
    const command = page.locator('pre').first()
    await command.getByRole('button').click()
    await expect(command.getByRole('button')).not.toHaveText('copied')
    await expect(page.getByRole('status')).toHaveText('Copy unavailable. Select the command text and copy it manually.')
    expect(await command.evaluate(pre => getComputedStyle(pre).userSelect)).not.toBe('none')
    await command.evaluate(pre => {
      const range = document.createRange(); range.selectNodeContents(pre.firstChild)
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    })
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('npx -y github:Zacaria/botters install')
    expect(errors).toEqual([])
  })
}
