# One-command agent setup

`npx -y github:Zacaria/botters install` registers the Botters stdio MCP server in detected user-level clients. Node 22+ is required. Installation only changes local client configuration; it never signs in, approves an agent, starts a match or changes global tool permissions.

## Behavior

- Detect Claude Code and Codex from PATH or existing user config; detect Claude Desktop, Cursor and Windsurf from existing user MCP config files. Respect `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_CONFIG_HOME` and `APPDATA`. Do not create config for undetected clients.
- Use `botters install --client <id>` to target exactly one client: `claude` (Claude Code), `codex`, `desktop` (Claude Desktop), `cursor` or `windsurf`. For example, `botters install --client codex --local` shows only Codex's offline setup and asks for confirmation. Add `--yes` for noninteractive use, or `--uninstall` to remove only that client's Botters entry. The selector accepts one exact ID, once; aliases, multiple targets and `--client=id` are not supported. A selected client that is not detected is an error, with no fallback to another client.
- Without `--client`, all detected clients remain targets. With it, excluded configs are not read, parsed, backed up or changed and excluded client CLIs are not looked up or called. An excluded malformed file or symlink does not block selection; the selected file still receives the full safety checks below.
- Show each target, destination, action and mode before requesting confirmation. `--yes` skips the prompt; noninteractive input without `--yes` changes nothing. No detected client is a helpful error, not a successful install.
- Online is the default: `BOTTERS_SERVER=https://botters.havesomecode.io`. `--local` sets `BOTTERS_SERVER` to the empty string so a parent environment cannot force online play. Use the online-capable `github:Zacaria/botters#pvp-online` package for both modes. No player name or credentials are copied into config.
- Use `claude mcp add --scope user` and `codex mcp add` when available. Updates remove/re-add only the Botters registration. Merge JSON/JSONC or TOML directly when a CLI is absent. Codex gets `startup_timeout_sec=60`, `tool_timeout_sec=60`, and `default_tools_approval_mode="approve"` for Botters alone. Explain this permission in the confirmation plan.
- Back up every existing edited config with a unique `.botters-backup-*` sibling, restricted to the user. Validate all targeted detected files before changing any; reject malformed config and symlinks. Preserve unrelated config values and servers, including those a client CLI might otherwise discard. JSON comments/formatting are retained; TOML may be reformatted. Detect concurrent file changes before writing. Restore the original file if a CLI or write fails; report failures and never claim completion for a failed target.
- Repeating the same install makes no writes, backups or CLI calls. `--uninstall` removes only the user-level `botters` entry from detected clients, leaves unrelated configuration and backups intact, and is also idempotent. Existing Botters-specific customization is replaced when updating; backups allow recovery.

## Paths

| Client | User config |
| --- | --- |
| Claude Code | `~/.claude.json` (`$CLAUDE_CONFIG_DIR/.claude.json` when set) |
| Codex | `~/.codex/config.toml` (`$CODEX_HOME/config.toml` when set) |
| Claude Desktop, macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop, Windows | `%APPDATA%/Claude/claude_desktop_config.json` |
| Claude Desktop, Linux (unofficial clients) | `$XDG_CONFIG_HOME/Claude/claude_desktop_config.json`, default `~/.config/Claude/…` |
| Cursor, all systems | `~/.cursor/mcp.json` |
| Windsurf, all systems | `~/.codeium/windsurf/mcp_config.json` |

Restart the agent application after installation. Project-level MCP entries can override user entries; this installer intentionally does not edit project config or managed policy.

## Release boundary

The advertised unqualified GitHub command resolves the repository default branch. The current default is `master`, which does not yet contain this installer. Independent review must precede integration into `pvp-online` and guide publication. Before promoting the one-command guide, the release owner must make the reviewed installer available at the default GitHub ref (merge the reviewed source there or change the default branch), then exercise the literal documented command in a fresh HOME. Until then, candidate checks use a packed local artifact; do not report the public command as released.
