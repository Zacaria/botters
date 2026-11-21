import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { replay, hash } from '../sim.js'

test('browser /sim.js replays the same fixed log as Node', async () => {
  const source = await readFile(new URL('../sim.js', import.meta.url))
  const server = createServer((req, res) => {
    if (req.url === '/sim.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(source) }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Replay</title>') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    const log = [
      { tick: 0, side: 0, input: { order: { bat: 0, x: 600, y: 350 } } },
      { tick: 12, side: 0, input: { toggle: 0 } },
      { tick: 24, side: 0, input: { release: 0 } },
    ]
    const opts = { tick: 80, minutes: 3, planets: 9 }
    const expected = hash(replay(1729, log, opts))
    const actual = await page.evaluate(async ({ log, opts }) => {
      const sim = await import('/sim.js')
      return sim.hash(sim.replay(1729, log, opts))
    }, { log, opts })
    assert.equal(actual, expected)
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
  }
})
