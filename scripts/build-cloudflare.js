import { build } from 'esbuild'
import { mkdir, copyFile } from 'node:fs/promises'
await mkdir('.cache/cloudflare', { recursive: true })
await copyFile('sim/pkg/botters_sim_bg.wasm', '.cache/cloudflare/botters_sim_bg.wasm')
await build({ entryPoints: ['cloudflare/worker.js'], outfile: '.cache/cloudflare/worker.js', bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', conditions: ['workerd','worker','browser'], mainFields: ['module','main'], packages: 'bundle', external: ['node:*','cloudflare:*','./botters_sim_bg.wasm'], plugins: [{ name: 'worker-wasm-runtime', setup(b) { b.onResolve({ filter: /ajv-provider\.js$/ }, () => ({ path: new URL('../cloudflare/sdk-schema.js', import.meta.url).pathname })); b.onResolve({ filter: /sim\/runtime\.js$/ }, () => ({ path: new URL('../cloudflare/sim-runtime.js', import.meta.url).pathname })) } }] })
console.log('Built Worker and compiled simulation WASM module; no credentials included.')
