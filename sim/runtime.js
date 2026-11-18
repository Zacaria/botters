import init, { initSync } from './pkg/botters_sim.js'
if (typeof process !== 'undefined' && process.versions?.node) {
  const { readFileSync } = await import('node:fs')
  initSync({ module: readFileSync(new URL('./pkg/botters_sim_bg.wasm', import.meta.url)) })
} else await init()
