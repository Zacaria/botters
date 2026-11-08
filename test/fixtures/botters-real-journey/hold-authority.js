// Browser-fixture-only barrier. Never loaded by either production entry point.
import { PostgresStore } from '../../../online/postgres-store.js'

const authorize = PostgresStore.prototype.authorize
let hold = false
const releases = new Set()
process.on('message', message => {
  if (message?.type === 'hold-authority') hold = true
  if (message?.type === 'release-authority') { hold = false; for (const release of releases) release(); releases.clear() }
})
PostgresStore.prototype.authorize = async function (...args) {
  if (hold) {
    await new Promise(resolve => {
      releases.add(resolve)
      process.send?.({ type: 'authority-held' })
    })
  }
  return authorize.apply(this, args)
}
