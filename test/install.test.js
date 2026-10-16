import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable, Writable } from 'node:stream'
import { parse as parseToml } from 'smol-toml'
import { parse as parseJson } from 'jsonc-parser'
import { planInstall, applyPlan, install, clientLocations } from '../install.js'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'botters-install-'))
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(home, { recursive: true, force: true }) })
  return home
}
async function put(path, text) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text) }
const options = home => ({ home, platform: 'linux', env: { HOME: home, PATH: '' }, lookup: () => null })
const capture = () => { let text = ''; return { output: new Writable({ write(chunk, _, cb) { text += chunk; cb() } }), text: () => text } }
const server = { command: 'other', args: ['secret'], env: { KEY: 'keep private' } }

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`detect and preserve every client on ${platform}; rerun and uninstall are idempotent`, async t => {
    const home = await fixture(t)
    const opts = { ...options(home), platform, env: { HOME: home, APPDATA: join(home, 'Roaming'), XDG_CONFIG_HOME: join(home, 'xdg') } }
    const paths = clientLocations(opts)
    assert.equal(paths.length, 5)
    if (platform === 'darwin') assert.match(paths[2].path, /Library\/Application Support\/Claude/)
    if (platform === 'linux') assert.match(paths[2].path, /xdg\/Claude/)
    if (platform === 'win32') assert.match(paths[2].path, /Roaming\/Claude/)
    for (const item of paths) await put(item.path, item.id === 'codex'
      ? 'model = "keep"\n[mcp_servers.other]\ncommand = "other"\nargs = ["secret"]\n[mcp_servers.other.env]\nKEY = "keep private"\n'
      : '{\n  // keep my comment\n  "preference": "keep",\n  "mcpServers": { "other": ' + JSON.stringify(server) + ', },\n}\n')
    const plan = await planInstall(opts)
    assert.equal(plan.length, 5)
    assert.ok(plan.every(p => p.action === 'install'))
    const logs = []
    await applyPlan(plan, { log: s => logs.push(s) })
    for (const item of paths) {
      const text = await readFile(item.path, 'utf8')
      const value = item.id === 'codex' ? JSON.parse(JSON.stringify(parseToml(text))) : parseJson(text)
      const servers = value[item.id === 'codex' ? 'mcp_servers' : 'mcpServers']
      assert.deepEqual(servers.other, server)
      assert.equal(servers.botters.env.BOTTERS_SERVER, 'https://botters.havesomecode.io')
      if (item.id === 'codex') {
        assert.equal(value.model, 'keep')
        assert.equal(servers.botters.startup_timeout_sec, 60)
        assert.equal(servers.botters.tool_timeout_sec, 60)
        assert.equal(servers.botters.default_tools_approval_mode, 'approve')
      } else { assert.equal(value.preference, 'keep'); assert.match(text, /keep my comment/) }
      const backups = (await readdir(join(item.path, '..'))).filter(f => f.includes('.botters-backup-'))
      assert.equal(backups.length, 1)
      assert.equal((await lstat(join(item.path, '..', backups[0]))).mode & 0o777, 0o600)
    }
    assert.ok(logs.every(s => !s.includes('secret') && !s.includes('keep private')))
    const unchanged = await planInstall(opts)
    assert.ok(unchanged.every(p => p.action === 'unchanged'))
    await applyPlan(unchanged, { run: () => assert.fail('CLI on no-op') })
    const local = await planInstall({ ...opts, local: true })
    assert.ok(local.every(p => p.action === 'update'))
    await applyPlan(local)
    for (const item of paths) {
      const text = await readFile(item.path, 'utf8')
      const value = item.id === 'codex' ? JSON.parse(JSON.stringify(parseToml(text))) : parseJson(text)
      assert.equal(value[item.id === 'codex' ? 'mcp_servers' : 'mcpServers'].botters.env.BOTTERS_SERVER, '')
    }
    await applyPlan(await planInstall({ ...opts, uninstall: true }))
    for (const item of paths) {
      const text = await readFile(item.path, 'utf8')
      const value = item.id === 'codex' ? JSON.parse(JSON.stringify(parseToml(text))) : parseJson(text)
      assert.deepEqual(value[item.id === 'codex' ? 'mcp_servers' : 'mcpServers'], { other: server })
    }
    assert.ok((await planInstall({ ...opts, uninstall: true })).every(p => p.action === 'unchanged'))
  })
}

test('empty HOME detects CLI clients only; honors custom homes; uses CLI with user scope and preserves values', async t => {
  const home = await fixture(t)
  const opts = { ...options(home), env: { CLAUDE_CONFIG_DIR: join(home, 'claude-space'), CODEX_HOME: join(home, 'codex-space') }, lookup: name => `/bin/${name}` }
  const plan = await planInstall(opts)
  assert.deepEqual(plan.map(p => p.id), ['claude', 'codex'])
  assert.equal(plan[0].path, join(home, 'claude-space/.claude.json'))
  assert.equal(plan[1].path, join(home, 'codex-space/config.toml'))
  const calls = []
  await applyPlan(plan, { run: async (command, args) => {
    calls.push([command, args])
    const item = plan.find(p => p.cli === command)
    assert.ok((await lstat(join(item.path, '..'))).isDirectory(), 'create config directory before invoking the client CLI')
    await put(item.path, item.id === 'claude' ? '{"mcpServers":{"botters":{"command":"npx"}}}' : '[mcp_servers.botters]\ncommand="npx"\n')
  } })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0][1].slice(0, 5), ['mcp', 'add', '--scope', 'user', 'botters'])
  assert.deepEqual(calls[1][1].slice(0, 3), ['mcp', 'add', 'botters'])
  const remove = await planInstall({ ...opts, uninstall: true })
  await applyPlan(remove, { run: async (command, args) => calls.push([command, args]) })
  assert.deepEqual(calls[2][1], ['mcp', 'remove', '--scope', 'user', 'botters'])
  assert.deepEqual(calls[3][1], ['mcp', 'remove', 'botters'])
})

test('confirmation declines by default and never writes without --yes in a pipe', async t => {
  const home = await fixture(t)
  const path = join(home, '.cursor/mcp.json')
  await put(path, '{}')
  for (const input of [Readable.from(['y\n']), Readable.from(['n\n'])]) {
    const out = capture()
    assert.equal(await install([], { ...options(home), input, output: out.output }), 1)
    assert.match(out.text(), /--yes/)
    assert.equal(await readFile(path, 'utf8'), '{}')
  }
  const input = Readable.from(['n\n']); input.isTTY = true
  const out = capture()
  assert.equal(await install([], { ...options(home), input, output: out.output }), 0)
  assert.match(out.text(), /Cursor/)
  assert.match(out.text(), /Cancelled/)
  assert.equal(await readFile(path, 'utf8'), '{}')
  const yes = Readable.from(['yes\n']); yes.isTTY = true
  assert.equal(await install([], { ...options(home), input: yes, output: capture().output }), 0)
  assert.ok(parseJson(await readFile(path, 'utf8')).mcpServers.botters)
})

test('--yes installs; no detection, help and unknown options do not write', async t => {
  const home = await fixture(t)
  assert.equal(await install(['--yes'], { ...options(home), output: capture().output }), 1)
  assert.equal(await install(['--help'], { ...options(home), output: capture().output }), 0)
  assert.equal(await install(['--yess'], { ...options(home), output: capture().output }), 1)
  assert.deepEqual(await readdir(home), [])
  await put(join(home, '.cursor/mcp.json'), '{}')
  assert.equal(await install(['--yes'], { ...options(home), output: capture().output }), 0)
  assert.ok(parseJson(await readFile(join(home, '.cursor/mcp.json'), 'utf8')).mcpServers.botters)
})

test('preflight rejects malformed/invalid config across all clients before any write', async t => {
  const home = await fixture(t)
  const paths = clientLocations(options(home))
  await put(paths[0].path, '{}')
  for (const broken of ['{oops', '{"mcpServers": []}', '{"mcpServers": null}', '[]', '{"mcpServers":{},"mcpServers":{}}', '{"mcpServers":{"botters":{},"botters":{}}}']) {
    await put(paths[3].path, broken)
    await assert.rejects(planInstall(options(home)), /Cursor/)
    assert.equal(await readFile(paths[0].path, 'utf8'), '{}')
    assert.deepEqual(await readdir(home), ['.claude.json', '.cursor'])
  }
  await put(paths[3].path, '{}')
  for (const broken of ['not toml', 'mcp_servers = []', 'mcp_servers = "wrong"']) {
    await put(paths[1].path, broken)
    await assert.rejects(planInstall(options(home)), /Codex/)
  }
})

test('rejects symlinks, concurrent modifications and restores config when a CLI fails', async t => {
  const home = await fixture(t)
  const path = join(home, '.claude.json')
  const target = join(home, 'target.json')
  await put(target, '{}')
  await symlink(target, path)
  await assert.rejects(planInstall(options(home)), /symlink/i)
  const { unlink } = await import('node:fs/promises'); await unlink(path)
  await put(path, '{"theme":"original"}')
  let plan = await planInstall({ ...options(home), lookup: name => name === 'claude' ? '/bin/claude' : null })
  await writeFile(path, '{"theme":"concurrent"}')
  await assert.rejects(applyPlan(plan), /changed/i)
  assert.equal(await readFile(path, 'utf8'), '{"theme":"concurrent"}')
  plan = await planInstall({ ...options(home), lookup: name => name === 'claude' ? '/bin/claude' : null })
  await assert.rejects(applyPlan(plan, { run: async () => { await writeFile(path, '{}'); throw new Error('private CLI output') } }), /Claude Code.*restored/)
  assert.equal(await readFile(path, 'utf8'), '{"theme":"concurrent"}')
})

test('updating a CLI registration removes only Botters; CLI side effects cannot erase other settings', async t => {
  const home = await fixture(t)
  const path = join(home, '.claude.json')
  await put(path, JSON.stringify({ theme: 'keep', mcpServers: { other: server, botters: { command: 'old' } } }))
  const opts = { ...options(home), lookup: name => name === 'claude' ? '/bin/claude' : null }
  const calls = []
  await applyPlan(await planInstall(opts), { run: async (_, args) => { calls.push(args); await writeFile(path, '{}') } })
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [['mcp', 'remove'], ['mcp', 'add']])
  const data = parseJson(await readFile(path, 'utf8'))
  assert.deepEqual(data.mcpServers.other, server)
  assert.equal(data.theme, 'keep')
  assert.equal(data.mcpServers.botters.command, 'npx')
})
