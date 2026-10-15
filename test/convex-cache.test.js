import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConvexStore, transaction } from '../online/store.js'

test('invocation cache commits guards, reloads conflicts in one query, and never caches report reads', async () => {
  const root = new ConvexStore({}), store = root.scoped(), calls = []
  let values = new Map([['a', '{"n":1}'], ['b', '{"n":2}'], ['log:x:0', '[1]']]), conflict = false
  store.call = async (kind, path, args) => {
    calls.push({ kind, args })
    if (kind === 'query') return args.keys.map(key => values.get(key.slice(store.prefix.length)) ?? null)
    if (conflict) { conflict = false; values.set('a', '{"n":10}'); return 0 }
    for (const e of args.entries) {
      const k = e.key.slice(store.prefix.length)
      if ((values.get(k) ?? null) !== e.raw) return 0
    }
    for (const e of args.entries) if (e.value !== '') values.set(e.key.slice(store.prefix.length), e.value)
    return 1
  }
  const run = () => transaction(store, async tx => { const a = await tx.get('a'), b = await tx.get('b'); a.n++; return a.n + b.n })
  assert.equal(await run(), 4)
  calls.length = 0
  assert.equal(await run(), 5)
  assert.equal(calls.length, 1, 'Warm transaction still verifies CAS but needs no serial reads')
  conflict = true; calls.length = 0
  assert.equal(await run(), 13)
  assert.equal(calls.filter(c => c.kind === 'query').length, 1)
  assert.deepEqual(calls.find(c => c.kind === 'query').args.keys, ['a', 'b'].map(k => store.prefix + k))
  await transaction(store, tx => tx.read('log:x:0'))
  values.set('log:x:0', '[1,2]')
  assert.deepEqual(await transaction(store, tx => tx.read('log:x:0')), [1, 2])
  assert.notEqual(root.scoped().cache, store.cache, 'Cache is never shared across requests')
})
