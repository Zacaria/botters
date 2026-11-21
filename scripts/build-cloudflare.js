import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
await mkdir('.cache/cloudflare', { recursive: true })
await build({ entryPoints: ['cloudflare/worker.js'], outfile: '.cache/cloudflare/worker.js', bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', conditions: ['workerd','worker','browser'], mainFields: ['module','main'], packages: 'bundle', external: ['node:*','cloudflare:*'], plugins: [{ name: 'worker-wasm-runtime', setup(b) { b.onResolve({ filter: /ajv-provider\.js$/ }, () => ({ path: new URL('../cloudflare/sdk-schema.js', import.meta.url).pathname })) } }] })
console.log('Built Worker; no credentials included.')
