import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

export function sourceHash() {
  const files = ['sim/Cargo.toml', 'sim/Cargo.lock']
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  walk('sim/src')
  const hash = createHash('sha256')
  for (const file of files) hash.update(file).update('\0').update(readFileSync(file)).update('\0')
  return hash.digest('hex')
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  execFileSync('cargo', ['build', '--manifest-path', 'sim/Cargo.toml', '--target', 'wasm32-unknown-unknown', '--release'], { stdio: 'inherit' })
  execFileSync('wasm-bindgen', ['sim/target/wasm32-unknown-unknown/release/botters_sim.wasm', '--target', 'web', '--out-dir', 'sim/pkg', '--no-typescript'], { stdio: 'inherit' })
  writeFileSync('sim/pkg/source.sha256', sourceHash() + '\n')
}
