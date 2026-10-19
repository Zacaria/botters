import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, symlink, readlink, unlink } from 'node:fs/promises'
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

async function fileState(path) {
  const stat = await lstat(path)
  const state = { mode: stat.mode, ino: stat.ino, mtime: stat.mtimeMs }
  if (stat.isSymbolicLink()) return { ...state, link: await readlink(path) }
  if (!stat.isDirectory()) return { ...state, text: await readFile(path, 'utf8') }
  const children = {}
  for (const name of (await readdir(path)).sort()) children[name] = await fileState(join(path, name))
  return { ...state, children }
}

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

for (const entry of ['CLI', 'planner']) {
  test(`selected client excludes unrelated configs before preflight (${entry})`, async t => {
    const home = await fixture(t)
    const codex = join(home, '.codex/config.toml'), cursor = join(home, '.cursor/mcp.json')
    await put(codex, 'model = "keep"\n[mcp_servers.other]\ncommand = "other"\n')
    await put(cursor, '{oops')
    const looked = [], out = capture()
    const opts = { ...options(home), lookup: name => { looked.push(name); return null } }
    if (entry === 'CLI') {
      assert.equal(await install(['--client', 'codex', '--yes'], { ...opts, output: out.output }), 0, out.text())
      assert.ok(parseToml(await readFile(codex, 'utf8')).mcp_servers.botters)
      assert.doesNotMatch(out.text(), /Claude|Cursor|Windsurf/)
    } else {
      const plan = await planInstall({ ...opts, client: 'codex' })
      assert.deepEqual(plan.map(item => item.id), ['codex'])
    }
    assert.deepEqual(looked, ['codex'])
    assert.equal(await readFile(cursor, 'utf8'), '{oops')
    assert.deepEqual(await readdir(join(home, '.cursor')), ['mcp.json'])
  })
}

for (const platform of ['darwin', 'linux', 'win32']) {
  for (const client of ['claude', 'codex', 'desktop', 'cursor', 'windsurf']) {
    test(`selected client ${client} on ${platform}: isolated install, rerun, local update and uninstall`, async t => {
      const home = await fixture(t), looked = [], calls = []
      const opts = { ...options(home), platform, env: {
        HOME: home, PATH: '', CLAUDE_CONFIG_DIR: join(home, 'claude-space'), CODEX_HOME: join(home, 'codex-space'),
        APPDATA: join(home, 'Roaming'), XDG_CONFIG_HOME: join(home, 'xdg'),
      }, lookup: name => { looked.push(name); return join(home, 'fake-bin', name) },
      run: async (command, args) => { calls.push([command, args]) } }
      const paths = clientLocations(opts), selected = paths.find(item => item.id === client)
      for (const item of paths) await put(item.path, item.id === 'codex'
        ? 'model = "keep"\n[mcp_servers.other]\ncommand = "other"\nargs = ["secret"]\n[mcp_servers.other.env]\nKEY = "keep private"\n'
        : '{\n// keep comment\n"theme":"keep","mcpServers":{"other":' + JSON.stringify(server) + '}}')
      const before = await fileState(home)
      const original = await readFile(selected.path, 'utf8'), mode = (await lstat(selected.path)).mode & 0o777
      const excluded = paths.filter(item => item.id !== client)
      const untouched = await Promise.all(excluded.map(item => fileState(join(item.path, '..'))))
      const out = capture(), cliClient = ['claude', 'codex'].includes(client)
      const invoke = args => install(['--client', client, '--yes', ...args], { ...opts, output: out.output })
      const data = async () => {
        const text = await readFile(selected.path, 'utf8')
        return client === 'codex' ? JSON.parse(JSON.stringify(parseToml(text))) : parseJson(text)
      }
      const key = client === 'codex' ? 'mcp_servers' : 'mcpServers'
      assert.equal(await invoke([]), 0, out.text())
      assert.deepEqual((await data())[key].other, server)
      assert.equal((await data())[client === 'codex' ? 'model' : 'theme'], 'keep')
      if (client !== 'codex') assert.match(await readFile(selected.path, 'utf8'), /keep comment/)
      assert.equal((await data())[key].botters.env.BOTTERS_SERVER, 'https://botters.havesomecode.io')
      assert.equal((await lstat(selected.path)).mode & 0o777, mode)
      const backups = (await readdir(join(selected.path, '..'))).filter(name => name.includes('.botters-backup-'))
      assert.equal(backups.length, 1)
      assert.equal(await readFile(join(selected.path, '..', backups[0]), 'utf8'), original)
      assert.equal((await lstat(join(selected.path, '..', backups[0]))).mode & 0o777, 0o600)
      const installed = await fileState(home), callCount = calls.length
      assert.equal(await invoke([]), 0)
      assert.deepEqual(await fileState(home), installed, 'rerun does not write or back up anything')
      assert.equal(calls.length, callCount)
      assert.equal(await invoke(['--local']), 0)
      assert.equal((await data())[key].botters.env.BOTTERS_SERVER, '')
      assert.equal(await invoke(['--uninstall']), 0)
      assert.deepEqual((await data())[key], { other: server })
      const removed = await fileState(home), removeCalls = calls.length
      assert.equal(await invoke(['--uninstall']), 0)
      assert.deepEqual(await fileState(home), removed)
      assert.equal(calls.length, removeCalls)
      assert.deepEqual(await Promise.all(excluded.map(item => fileState(join(item.path, '..')))), untouched)
      assert.deepEqual(Object.keys((await fileState(home)).children), Object.keys(before.children), 'no excluded directories created')
      assert.deepEqual(looked, cliClient ? Array(5).fill(client) : [])
      assert.ok(calls.every(([command]) => command === join(home, 'fake-bin', client)))
      assert.deepEqual(calls.map(([, args]) => args.slice(0, 2)), cliClient ? [['mcp', 'add'], ['mcp', 'remove'], ['mcp', 'add'], ['mcp', 'remove']] : [])
      assert.match(out.text(), new RegExp(selected.name))
      for (const item of excluded) assert.ok(!out.text().includes(item.name), `excluded ${item.name} in logs`)
      assert.doesNotMatch(out.text(), /secret|keep private/)
    })
  }
}

test('selected client skips absent configs and excluded symlinks; default and selected preflight stay strict', async t => {
  const home = await fixture(t), codex = join(home, '.codex/config.toml'), cursor = join(home, '.cursor/mcp.json')
  await put(codex, 'model="keep"\n')
  await put(cursor, '{oops')
  const opts = { ...options(home), lookup: name => { assert.equal(name, 'codex'); return null } }
  let before = await fileState(home)
  assert.equal(await install(['--yes'], { ...options(home), output: capture().output }), 1)
  assert.deepEqual(await fileState(home), before)
  await assert.rejects(planInstall({ ...options(home), client: 'cursor' }), /Cursor.*Invalid JSON/)
  assert.deepEqual(await fileState(home), before)
  await unlink(cursor)
  const target = join(home, 'target.json')
  await put(target, '{}')
  await symlink(target, cursor)
  before = await fileState(home)
  assert.equal(await install(['--yes'], { ...options(home), output: capture().output }), 1)
  await assert.rejects(planInstall({ ...options(home), client: 'cursor' }), /Cursor.*symlink/)
  assert.deepEqual(await fileState(home), before)
  assert.equal(await install(['--client', 'codex', '--yes'], { ...opts, output: capture().output }), 0)
  assert.equal(await readFile(target, 'utf8'), '{}')
  assert.equal(await readlink(cursor), target)
  assert.deepEqual(await readdir(home), ['.codex', '.cursor', 'target.json'])
  await put(codex, 'not toml')
  const malformed = await fileState(home)
  assert.equal(await install(['--client', 'codex', '--yes'], { ...opts, output: capture().output }), 1)
  assert.deepEqual(await fileState(home), malformed)
})

test('selected client validates CLI arguments before planning and rejects unknown planner targets', async t => {
  const home = await fixture(t)
  for (const args of [
    ['--client'], ['--client', '--yes'], ['--client', 'unknown'], ['--client', 'CODEX'],
    ['--client', 'codex', '--client', 'cursor'], ['--client', 'codex', '--client', 'codex'],
    ['--client=codex'], ['--client', 'codex', '--yess'], ['--client', 'codex', 'cursor'],
  ]) {
    const out = capture()
    const opts = { ...options(home), output: out.output, lookup: () => assert.fail('lookup for invalid args'), run: () => assert.fail('CLI for invalid args') }
    Object.defineProperty(opts, 'home', { get() { assert.fail('planning invalid CLI arguments') } })
    assert.equal(await install(args, opts), 1, JSON.stringify(args))
    assert.match(out.text(), /Usage:.*--client <id>/)
    for (const id of ['claude', 'codex', 'desktop', 'cursor', 'windsurf']) assert.ok(out.text().includes(id))
  }
  for (const client of ['unknown', '', null, ['codex']]) {
    await assert.rejects(planInstall({ ...options(home), client, lookup: () => assert.fail('lookup for unknown target') }), /client.*claude.*codex.*desktop.*cursor.*windsurf/i)
  }
  const out = capture()
  assert.equal(await install(['--client', 'codex', '--help'], { ...options(home), output: out.output, lookup: () => assert.fail('help lookup') }), 0)
  assert.match(out.text(), /--client <id>/)
  assert.deepEqual(await readdir(home), [])
})

test('selected client not detected never falls back; CLI-only detection still creates only its config', async t => {
  const home = await fixture(t), cursor = join(home, '.cursor/mcp.json')
  await put(cursor, '{}')
  const before = await fileState(home), out = capture(), looked = []
  const opts = { ...options(home), output: out.output, lookup: name => { looked.push(name); return null } }
  assert.equal(await install(['--client', 'codex', '--yes'], opts), 1)
  assert.match(out.text(), /codex.*not detected/i)
  assert.deepEqual(looked, ['codex'])
  assert.deepEqual(await fileState(home), before)
  for (const client of ['claude', 'codex']) {
    const calls = []
    const selected = { ...options(home), client, lookup: name => { assert.equal(name, client); return join(home, 'fake-bin', name) } }
    const plan = await planInstall(selected)
    assert.deepEqual(plan.map(item => item.id), [client])
    await applyPlan(plan, { run: async (command, args) => { calls.push([command, args]); assert.ok((await lstat(join(plan[0].path, '..'))).isDirectory()) } })
    assert.equal(calls.length, 1)
    assert.equal((await lstat(plan[0].path)).mode & 0o777, 0o600)
  }
  assert.equal(await readFile(cursor, 'utf8'), '{}')
})

test('selected client keeps interactive confirmation and refuses pipes without --yes', async t => {
  const home = await fixture(t), path = join(home, '.cursor/mcp.json')
  await put(path, '{}')
  const before = await fileState(home)
  for (const answer of ['y\n', 'n\n']) {
    const out = capture()
    assert.equal(await install(['--client', 'cursor'], { ...options(home), input: Readable.from([answer]), output: out.output }), 1)
    assert.match(out.text(), /--yes/)
    assert.deepEqual(await fileState(home), before)
  }
  for (const answer of ['\n', 'n\n', 'yes\n']) {
    const input = Readable.from([answer]); input.isTTY = true
    const out = capture()
    assert.equal(await install(['--client', 'cursor'], { ...options(home), input, output: out.output }), 0)
    assert.match(out.text(), /Apply these changes/)
    if (answer !== 'yes\n') { assert.match(out.text(), /Cancelled/); assert.deepEqual(await fileState(home), before) }
  }
  assert.ok(parseJson(await readFile(path, 'utf8')).mcpServers.botters)
})

test('selected client preserves concurrent-change and CLI restoration guards', async t => {
  const home = await fixture(t), path = join(home, '.claude.json')
  await put(path, '{"theme":"original"}')
  await put(join(home, '.cursor/mcp.json'), '{oops')
  const opts = { ...options(home), client: 'claude', lookup: name => { assert.equal(name, 'claude'); return join(home, 'fake-bin', name) } }
  const plan = await planInstall(opts)
  await writeFile(path, '{"theme":"concurrent"}')
  const before = await fileState(home)
  await assert.rejects(applyPlan(plan, { run: () => assert.fail('CLI before concurrency check') }), /changed/)
  assert.deepEqual(await fileState(home), before)
  await assert.rejects(applyPlan(await planInstall(opts), { run: async () => { await writeFile(path, '{}'); throw new Error('private CLI output') } }), /Claude Code.*restored/)
  assert.equal(await readFile(path, 'utf8'), '{"theme":"concurrent"}')
  assert.equal(await readFile(join(home, '.cursor/mcp.json'), 'utf8'), '{oops')
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
