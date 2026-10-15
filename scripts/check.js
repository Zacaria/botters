import { readFile, readdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const files = []
for (const dir of ['.', 'api', 'online', 'scripts', 'test', 'e2e']) for (const name of await readdir(dir)) if (name.endsWith('.js')) files.push(join(dir, name))
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
const temp = await mkdtemp(join(tmpdir(), 'botters-check-'))
try {
  for (const file of ['index.html', 'guide.html']) {
    const html = await readFile(file, 'utf8')
    for (const [i, match] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].entries()) {
      const path = join(temp, `${file}-${i}.${match[1].includes('module') ? 'mjs' : 'js'}`)
      await writeFile(path, match[2]); execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' })
    }
  }
} finally { await rm(temp, { recursive: true }) }
for (const file of ['package.json', 'vercel.json', 'docs/pvp-benchmark.json']) JSON.parse(await readFile(file, 'utf8'))
console.log(`Syntax checked ${files.length} JS files, inline browser scripts and JSON configuration. No separate lint/type/format tool is configured.`)
