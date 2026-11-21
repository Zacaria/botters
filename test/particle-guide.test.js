import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('guide describes particle battalion controls and API', async () => {
  const html = await readFile(new URL('../guide.html', import.meta.url), 'utf8')
  for (const action of ['Select a battalion', 'Move', 'Flank', 'Detach', 'Release', 'Toggle a rule']) assert.ok(html.includes(action), action)
  assert.match(html, /"order":\{"bat":12,"x":600,"y":350\}/)
  assert.doesNotMatch(html, /order_swarm|split_swarm|release_swarm/)
})
