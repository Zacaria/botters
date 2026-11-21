import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CONDITIONS, ACTIONS } from '../sim.js'

test('guide describes particle battalion controls, every gambit term and the agent API', async () => {
  const html = await readFile(new URL('../guide.html', import.meta.url), 'utf8')
  for (const action of ['Select a battalion', 'Move', 'Flank', 'Detach', 'Release', 'Toggle a rule']) assert.ok(html.includes(action), action)
  for (const term of [...Object.keys(CONDITIONS), ...Object.keys(ACTIONS)]) assert.ok(html.includes(`<code>${term}</code>`), term)
  assert.match(html, /"toggle":2,"why":/)
  assert.doesNotMatch(html, /"order":\{"bat"/) // agents get no hand orders
  assert.doesNotMatch(html, /order_swarm|split_swarm|release_swarm|order_battalion/)
})
