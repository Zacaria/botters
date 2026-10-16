// Local acceptance check: real installed CLIs, fresh HOME, packed npx entrypoint,
// and MCP tools/list only. No login, agent pairing or match writes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { parse } from 'smol-toml'

const root = resolve('.')
const temp = await mkdtemp(join(tmpdir(), 'botters-real-install space-'))
const cache = join(root, '.cache/install-npm')
await mkdir(cache, { recursive: true })
const env = { PATH: process.env.PATH, HOME: join(temp, 'home'), CODEX_HOME: join(temp, 'home/.codex'), CLAUDE_CONFIG_DIR: join(temp, 'home/.claude'), TMPDIR: process.env.TMPDIR || tmpdir(), npm_config_cache: cache, NO_COLOR: '1', DISABLE_AUTOUPDATER: '1' }
await mkdir(env.HOME, { recursive: true })
const command = (bin, args, cwd = root) => execFileSync(bin, args, { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 }).trim()
try {
  const evidence = { baseCommit: command('git', ['rev-parse', 'HEAD']), node: process.version, claude: command('claude', ['--version']), codex: command('codex', ['--version']), sourceHashes: {}, steps: [], tools: {} }
  const pack = JSON.parse(command('npm', ['pack', '--json', '--pack-destination', temp]))[0]
  assert.ok(pack.files.some(f => f.path === 'install.js'))
  const tarball = join(temp, pack.filename)
  const setup = flags => command('npx', ['--yes', '--package', tarball, 'botters', 'install', ...flags])
  const first = setup(['--yes'])
  assert.match(first, /Claude Code: configured/)
  assert.match(first, /Codex: configured/)
  evidence.steps.push({ step: 'packed npx install in fresh HOME', passed: true, output: first.replaceAll(temp, '<TEMP>') })
  const claudePath = join(env.CLAUDE_CONFIG_DIR, '.claude.json'), codexPath = join(env.CODEX_HOME, 'config.toml')
  const before = [await readFile(claudePath, 'utf8'), await readFile(codexPath, 'utf8')]
  const claude = JSON.parse(before[0]).mcpServers.botters
  const codex = parse(before[1]).mcp_servers.botters
  assert.equal(codex.default_tools_approval_mode, 'approve')
  const cliClaude = command('claude', ['mcp', 'get', 'botters'])
  assert.match(cliClaude, /User config/)
  const cliCodex = JSON.parse(command('codex', ['mcp', 'get', 'botters', '--json']))
  assert.equal(cliCodex.name, 'botters')
  assert.equal(cliCodex.startup_timeout_sec, 60)
  assert.equal(cliCodex.tool_timeout_sec, 60)
  // Codex 0.159 omits this field in mcp get JSON. Verify the on-disk TOML
  // above, and also the CLI representation when a newer version exposes it.
  if (Object.hasOwn(cliCodex, 'default_tools_approval_mode')) assert.equal(cliCodex.default_tools_approval_mode, 'approve')
  evidence.codexApprovalReadback = Object.hasOwn(cliCodex, 'default_tools_approval_mode') ? 'config.toml and CLI JSON' : 'config.toml; installed CLI JSON omits approval policy'
  evidence.steps.push({ step: 'both real client CLIs read the registration', passed: true })
  for (const [name, config] of Object.entries({ claude, codex, packed: { command: 'npx', args: ['--yes', '--package', tarball, 'botters'], env: { BOTTERS_SERVER: claude.env.BOTTERS_SERVER } } })) {
    const client = new Client({ name: 'botters-install-acceptance', version: '1' })
    const transport = new StdioClientTransport({ command: config.command, args: config.args, env: { ...env, ...config.env, BOTTERS_OPEN: '0' }, stderr: 'pipe' })
    try {
      await client.connect(transport, { timeout: 150000 })
      const tools = await client.listTools({}, { timeout: 60000 })
      const names = tools.tools.map(t => t.name).sort()
      assert.ok(names.includes('join_match') && names.includes('set_gambits'))
      evidence.tools[name] = names
    } finally { await client.close() }
  }
  // Reading Claude's config through its CLI initializes its own metadata. Take
  // the no-op baseline after that external mutation, not before it.
  const rerunBaseline = [await readFile(claudePath, 'utf8'), await readFile(codexPath, 'utf8')]
  const beforeFiles = (await Promise.all([env.CLAUDE_CONFIG_DIR, env.CODEX_HOME].map(dir => readdir(dir)))).flat().sort()
  const rerun = setup(['--yes'])
  assert.match(rerun, /Nothing to change/)
  assert.deepEqual([await readFile(claudePath, 'utf8'), await readFile(codexPath, 'utf8')], rerunBaseline)
  assert.deepEqual((await Promise.all([env.CLAUDE_CONFIG_DIR, env.CODEX_HOME].map(dir => readdir(dir)))).flat().sort(), beforeFiles)
  evidence.steps.push({ step: 'rerun: byte-identical files and no backups', passed: true })
  assert.match(setup(['--yes', '--local']), /offline house play/)
  assert.equal(JSON.parse(await readFile(claudePath, 'utf8')).mcpServers.botters.env.BOTTERS_SERVER, '')
  assert.equal(parse(await readFile(codexPath, 'utf8')).mcp_servers.botters.env.BOTTERS_SERVER, '')
  evidence.steps.push({ step: 'real CLI update to offline-only', passed: true })
  const removed = setup(['--yes', '--uninstall'])
  assert.match(removed, /Botters removed/)
  assert.equal(JSON.parse(await readFile(claudePath, 'utf8')).mcpServers?.botters, undefined)
  assert.equal(parse(await readFile(codexPath, 'utf8')).mcp_servers?.botters, undefined)
  assert.match(setup(['--yes', '--uninstall']), /Nothing to change/)
  evidence.steps.push({ step: 'real CLI uninstall and repeat uninstall', passed: true })
  for (const path of ['install.js', 'client.js', 'guide.html', 'README.md', 'package.json', 'package-lock.json', 'test/install.test.js', 'scripts/verify-install.js', 'e2e/install.spec.js', 'docs/install.md']) evidence.sourceHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex')
  evidence.package = { files: pack.files.map(f => f.path), shasum: pack.shasum, integrity: pack.integrity }
  await writeFile('docs/install-verification.json', JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} finally { await rm(temp, { recursive: true, force: true }) }
