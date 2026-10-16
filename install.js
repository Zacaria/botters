// User-level MCP setup. Kept separate so installation never starts the game.
import { access, lstat, readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { join, delimiter, dirname, isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { parse as parseJson, parseTree, modify, applyEdits } from 'jsonc-parser'
import spawn from 'cross-spawn'

const PACKAGE = 'github:Zacaria/botters#pvp-online'
const ONLINE = 'https://botters.havesomecode.io'
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => Object.hasOwn(value, key)

export function clientLocations({ home = homedir(), platform = process.platform, env = process.env } = {}) {
  const desktop = platform === 'darwin' ? join(home, 'Library/Application Support')
    : platform === 'win32' ? env.APPDATA || join(home, 'AppData/Roaming')
      : env.XDG_CONFIG_HOME || join(home, '.config')
  return [
    { id: 'claude', name: 'Claude Code', path: env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json') },
    { id: 'codex', name: 'Codex', path: join(env.CODEX_HOME || join(home, '.codex'), 'config.toml') },
    { id: 'desktop', name: 'Claude Desktop', path: join(desktop, 'Claude/claude_desktop_config.json') },
    { id: 'cursor', name: 'Cursor', path: join(home, '.cursor/mcp.json') },
    { id: 'windsurf', name: 'Windsurf', path: join(home, '.codeium/windsurf/mcp_config.json') },
  ]
}

async function lookupCommand(name, env) {
  const extensions = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (env.PATH || '').split(delimiter).filter(Boolean)) for (const ext of extensions) {
    const path = resolve(dir, name + ext)
    try { await access(path, constants.X_OK); if ((await lstat(path)).isDirectory()) continue; return path } catch {}
  }
  return null
}

async function snapshot(path) {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`)
    if (!stat.isFile()) throw new Error(`Not a regular config file: ${path}`)
    return { original: await readFile(path, 'utf8'), mode: stat.mode & 0o777 }
  } catch (error) { if (error.code === 'ENOENT') return { original: null, mode: 0o600 }; throw error }
}

function parseConfig(text, item) {
  let data
  if (text === null || text.trim() === '') data = {}
  else if (item.id === 'codex') {
    try { data = parseToml(text) } catch { throw new Error('Invalid TOML; fix the config file and rerun.') }
  }
  else {
    const errors = []
    data = parseJson(text, errors, { allowTrailingComma: true })
    if (errors.length) throw new Error('Invalid JSON/JSONC')
    const checkDuplicates = node => {
      if (node.type === 'object') {
        const names = node.children.map(property => property.children[0].value)
        if (new Set(names).size !== names.length) throw new Error('Duplicate JSON keys; fix the config file and rerun.')
      }
      for (const child of node.children || []) checkDuplicates(child)
    }
    checkDuplicates(parseTree(text, [], { allowTrailingComma: true }))
  }
  const key = item.id === 'codex' ? 'mcp_servers' : 'mcpServers'
  if (!object(data) || (own(data, key) && !object(data[key]))) throw new Error(`Expected an object for ${key}`)
  return { data, key }
}

export async function planInstall({ home = homedir(), platform = process.platform, env = process.env, lookup = name => lookupCommand(name, env), local = false, uninstall = false } = {}) {
  const plan = []
  for (const item of clientLocations({ home, platform, env })) {
    try {
      if (!isAbsolute(item.path)) throw new Error('Config directory must be an absolute path')
      const state = await snapshot(item.path)
      const cli = ['claude', 'codex'].includes(item.id) ? await lookup(item.id) : null
      if (state.original === null && !cli) continue
      const { data, key } = parseConfig(state.original, item)
      const previous = own(data, key) && own(data[key], 'botters') ? data[key].botters : undefined
      const desired = uninstall ? undefined : {
        ...(item.id === 'claude' && { type: 'stdio' }),
        command: 'npx', args: ['-y', PACKAGE], env: { BOTTERS_SERVER: local ? '' : ONLINE },
        ...(item.id === 'codex' && { startup_timeout_sec: 60, tool_timeout_sec: 60, default_tools_approval_mode: 'approve' }),
      }
      const action = isDeepStrictEqual(previous === undefined ? previous : JSON.parse(JSON.stringify(previous)), desired) ? 'unchanged' : uninstall ? 'remove' : previous === undefined ? 'install' : 'update'
      let next = state.original
      if (action !== 'unchanged') {
        if (item.id === 'codex') {
          if (!own(data, key)) data[key] = {}
          if (uninstall) delete data[key].botters
          else data[key].botters = desired
          next = stringifyToml(data)
        } else {
          const source = state.original?.trim() ? state.original : '{}'
          next = applyEdits(source, modify(source, [key, 'botters'], desired, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: source.includes('\r\n') ? '\r\n' : '\n' } }))
        }
      }
      plan.push({ ...item, ...state, cli, previous, desired, action, next, env })
    } catch (error) { throw new Error(`${item.name}: ${error.message}`, { cause: error }) }
  }
  return plan
}

async function atomicWrite(path, text, mode) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.botters-tmp-${randomUUID()}`
  try {
    await writeFile(temp, text, { flag: 'wx', mode })
    await rename(temp, path)
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

async function runCLI(command, args, env) {
  // cross-spawn handles npm's .cmd shims on Windows without hand-built shell commands.
  await new Promise((ok, fail) => {
    const child = spawn(command, args, { env, stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => { child.kill(); fail(new Error('Client CLI timed out')) }, 30000)
    child.once('error', error => { clearTimeout(timer); fail(error) })
    child.once('close', code => { clearTimeout(timer); code === 0 ? ok() : fail(new Error('Client CLI failed')) })
  })
}

async function assertUnchanged(item) {
  if ((await snapshot(item.path)).original !== item.original) throw new Error(`${item.name}: config changed since the plan was shown; rerun setup.`)
}

function cliArgs(item, operation) {
  const scope = item.id === 'claude' ? ['--scope', 'user'] : []
  if (operation === 'remove') return ['mcp', 'remove', ...scope, 'botters']
  return ['mcp', 'add', ...scope, 'botters', item.id === 'claude' ? '-e' : '--env', `BOTTERS_SERVER=${item.desired.env.BOTTERS_SERVER}`, '--', 'npx', '-y', PACKAGE]
}

export async function applyPlan(plan, { run = runCLI, log = () => {} } = {}) {
  // Recheck every destination before the first write, including after a slow confirmation.
  for (const item of plan) await assertUnchanged(item)
  for (const item of plan) {
    if (item.action === 'unchanged') { log(`${item.name}: unchanged`); continue }
    await assertUnchanged(item)
    let backup
    if (item.original !== null) {
      backup = `${item.path}.botters-backup-${randomUUID()}`
      await writeFile(backup, item.original, { flag: 'wx', mode: 0o600 })
    }
    try {
      await mkdir(dirname(item.path), { recursive: true, mode: 0o700 })
      if (item.cli) {
        if (item.previous !== undefined) await run(item.cli, cliArgs(item, 'remove'), item.env)
        if (item.action !== 'remove') await run(item.cli, cliArgs(item, 'add'), item.env)
      }
      // Use the preflight merge rather than trusting a CLI to preserve unknown settings.
      await atomicWrite(item.path, item.next, item.mode)
      if ((await readFile(item.path, 'utf8')) !== item.next) throw new Error('Config readback failed')
    } catch {
      try {
        if (item.original === null) await unlink(item.path).catch(error => { if (error.code !== 'ENOENT') throw error })
        else await atomicWrite(item.path, item.original, item.mode)
      } catch { throw new Error(`${item.name}: setup failed and automatic restore failed. Recover from ${backup || 'your original configuration'}.`) }
      throw new Error(`${item.name}: setup failed; original configuration restored. Check your client CLI and rerun.`)
    }
    log(`${item.name}: ${item.action === 'remove' ? 'removed' : 'configured'} — ${item.path}${backup ? ` (backup: ${backup})` : ''}`)
  }
}

export async function install(args = [], options = {}) {
  const { input = process.stdin, output = process.stdout } = options
  const log = text => output.write(`${text}\n`)
  const allowed = new Set(['--yes', '--local', '--uninstall', '--help'])
  if (args.some(arg => !allowed.has(arg))) { log('Unknown install option. Use: botters install [--yes] [--local] [--uninstall]'); return 1 }
  if (args.includes('--help')) { log('Usage: botters install [--yes] [--local] [--uninstall]\nDetect installed agents and show user-level MCP changes before asking.\n--yes: skip confirmation\n--local: offline house play instead of online\n--uninstall: remove only Botters registrations'); return 0 }
  try {
    const uninstall = args.includes('--uninstall'), local = args.includes('--local')
    const plan = await planInstall({ ...options, uninstall, local })
    if (!plan.length) { log('No supported agent found. Install Claude Code or Codex, or create your desktop client’s MCP config, then rerun. Manual setup: https://botters.havesomecode.io/guide'); return 1 }
    log(uninstall ? 'Remove Botters from detected user configs:' : `Botters setup: ${local ? 'offline house play' : ONLINE}`)
    for (const item of plan) log(`  ${item.name}: ${item.action} — ${item.path}${item.action !== 'unchanged' ? ` (${item.cli ? 'client CLI + config merge' : 'config merge'}${item.original !== null ? '; backup first' : ''})` : ''}`)
    if (plan.every(item => item.action === 'unchanged')) { log('Nothing to change.'); return 0 }
    if (!uninstall && plan.some(item => item.id === 'codex' && item.action !== 'unchanged')) log('Codex: 60-second startup/tool timeouts; automatically approve Botters tools only.')
    if (!args.includes('--yes')) {
      if (!input.isTTY) { log('No files changed. Run again in a terminal, or add --yes to accept these changes.'); return 1 }
      const prompt = createInterface({ input, output })
      let answer
      try { answer = await prompt.question('Apply these changes? [y/N] ') } finally { prompt.close() }
      if (!/^y(es)?$/i.test(answer.trim())) { log('Cancelled. No files changed.'); return 0 }
    }
    await applyPlan(plan, { run: options.run, log })
    log(uninstall ? 'Botters removed. Restart your agent to reload its tools.' : 'Restart your agent, then say: Let’s play Botters.')
    return 0
  } catch (error) { log(`Setup stopped: ${error.message}`); return 1 }
}
