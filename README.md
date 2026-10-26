# Botters

A 1v1 real-time space strategy game you play **with your AI agent**. Swarms of particles conquer and eat planets. Your agent (Claude Code, Codex, any MCP client) writes the **gambits**, the `IF condition → action` rules every swarm follows. You write the doctrine, edit the gambits, switch rules on and off, and grab one swarm by hand when it matters. No model runs in the real-time loop: a match costs only your agent's tool calls.

## Play

Sign in at https://botters.havesomecode.io with Google or a verified email/password account. Select **Play online** for matchmaking, or **Create room** and share its code/link. The older https://botters.vercel.app address remains public and links to owned-domain sign-in. House modes still run locally without an account.

Requires Node 22+. Connect your installed agents with one command:

```bash
npx -y github:Zacaria/botters install
```

It detects Claude Code, Codex, Claude Desktop, Cursor and Windsurf, shows the changes and asks before writing. Existing config files are backed up; other MCP servers are kept. Codex gets 60-second startup/tool timeouts and automatic approval for Botters tools only. Restart your agent, then tell it "let's play Botters".

Each player keeps their own agent subscription/model keys. Botters never runs inference. The agent opens a ten-minute approval link; connect it explicitly in your signed-in browser, then start matches yourself. It receives no human/account token. Disconnect it in the lobby to revoke its seven-day grant. Signing in on another device resumes your account, room and recent history. Verified-account Elo is separate from old name-only ratings; names are not merged or adopted. Elo remains casual, not proof of identity. See `docs/auth.md` for configuration and privacy; live release status is recorded in `docs/public-pages-release.md`.

Use `install --local` for offline-only house games, `install --yes` for noninteractive setup, or `install --uninstall` to remove the Botters registrations. Rerunning an unchanged setup does nothing. Custom config locations and project overrides: see `docs/install.md`.

No agent yet? `npx -y github:Zacaria/botters` opens the game locally to play alone, without an account.

### Browser assistants: remote MCP

The remote gateway source is in `web-mcp.js`. It uses OAuth 2.1, S256 PKCE and the existing signed-in Botters agent approval; the assistant receives agent access, never account cookies or human-control tokens. A registered connector does not start a match. Local stdio installation above remains unchanged.

Operator setup, private token-state storage and the consent flow are documented in [`docs/mcp-oauth.md`](docs/mcp-oauth.md). Live connector address: `https://play.botters.havesomecode.io/mcp`. ChatGPT has completed a real match through it; other web assistants are untested.

<details>
<summary>Manual setup fallback</summary>

If your client was not detected, register the stdio server yourself:

```bash
claude mcp add --scope user botters -e BOTTERS_SERVER=https://botters.havesomecode.io -- npx -y github:Zacaria/botters#pvp-online
codex mcp add botters --env BOTTERS_SERVER=https://botters.havesomecode.io -- npx -y github:Zacaria/botters#pvp-online
```

For Codex, add `startup_timeout_sec = 60`, `tool_timeout_sec = 60` and `default_tools_approval_mode = "approve"` under `[mcp_servers.botters]` in `~/.codex/config.toml`. Other clients: see the manual fallback at `/guide`.
</details>

## Play on a Mac (dev checkout)

Double-click `play.command`. It starts the server and Codex, and your lobby opens in the browser. Write your doctrine, pick a mode, press **Play**.

## Run by hand

```bash
npm install
npm run server          # http://localhost:8787: start screen, or play alone
```

Then plug your agent. The full guide is at `http://localhost:8787/guide`.

## Flow

1. Your agent calls `join_match`: it opens (or links) your **lobby** and waits.
2. The lobby shows a live house-vs-house battle behind one choice (Easy / Normal / Hard / vs Human) and **PLAY**. Under **Strategy & settings** you write the **doctrine** (your strategy in your words, 500 characters) and pick the opponent (house easy / normal / hard, or another player), the length (3 / 5 / 8 min), the map (16 / 28 / 40 planets), the planning countdown, and who writes the opening gambits.
3. **Play**: your agent receives the doctrine and writes the opening gambits during the countdown.
4. In the match, the panel shows who last wrote the gambits and why; new rules flash. You can edit the gambits, switch rules (click, 1–0), change the doctrine, message or ping your agent, and grab swarms. Each of your actions reaches your agent as a `HUMAN …` event. **Surrender** asks for confirmation and ends the match as a loss, even during planning; **menu** leaves the match running so you can resume it. Surrender works locally and online, including rooms; only the human can surrender (`POST /surrender` with their human token). The result, history and Elo use the normal match-end flow, then you can play again or request a room rematch.
5. End screen: the same match replayed without your actions and without your agent's, then **Play again**. After online matchmaking, **Rematch** keeps the same opponent: the first player opens a room and waits; the second accepts from their result screen. Both must accept before the next PvP starts. Match length, map size and planning countdown are preserved, while each player supplies their own current opening/agent preference. It never falls back to a house opponent. You can leave the waiting room instead. The lobby lists your last 10 matches.

## Rules

- Map 1200×700, mirrored planets plus one home planet per side, included in the selected total of 16, 28 or 40 planets in every mode. Six-side maps include a mirrored pair on the horizontal centreline to keep the exact total. Each side starts with 3 swarms of 3,000 particles.
- Owned planets are slowly eaten and turned into particles for their owner. Most particles at the end wins; no swarms and no planets left loses at once.
- Fights use the contact front: only the front of two touching swarms fights (width = the smaller swarm's diameter) and a swarm much bigger than its enemy wraps it. Half of what a swarm kills joins it but is digested slowly, which also slows it. Simultaneous attackers share each target's actual losses in proportion to their damage; they cannot digest the same particles twice. A swarm that touches no planet and kills nothing for too long starves (gambit conditions `hungry` and `full`). Big swarms move slower. Overlapping friendly swarms merge.
- Modes: `1v1`, `2v2` (you and a house ally against two house bots), `ffa4` and `ffa6` (free-for-all against house bots). Human-versus-human queue and rooms stay duels. Allies share vision and never fight. Colour identifies the team (your team pink, each enemy team its own colour). All swarms are the same kind; size, hunger and digestion affect how they move and fight.
- Fog of war: you see enemies within 150 of your swarms and 80 of your planets.
- Gambits: up to 10 rules per side, first enabled match wins, re-evaluated every 0.5 s. Conditions and actions: `GET /rules`.
- A swarm grabbed by hand (by you or your agent) ignores the gambits until released.
- Agents: max 5 inputs per second. The house plays fixed gambits with no agent.

## Agent settings (env, or `.env` next to `client.js`)

| Var | Default |
|---|---|
| `BOTTERS_SERVER` | unset: reuse `http://localhost:8787` if running, else host the game in-process |
| `BOTTERS_NAME` | `you` |
| `BOTTERS_SETUP` | `agent` (shown to your opponent, e.g. `codex`) |
| `BOTTERS_OPEN` | default browser; `0` never opens it, an app name picks one (macOS) |

The default doctrine comes from `DOCTRINE.md`; each player edits their own in the lobby.

## Test

```bash
npm test
npm run check
npm run build
node scripts/verify-install.js # real Claude/Codex, isolated HOME, packed npx + MCP tools/list only
npm run test:browser       # fresh ephemeral backend per test; Brave, accelerated clock, no live data
npm run test:auth:browser  # real Better Auth + captured test mail, isolated loopback only
npm run test:auth:convex   # actual Convex component + proxy, isolated test database
BOTTERS_SERVER=https://PREVIEW_URL npm run test:online # two real stdio MCP clients, full wall-clock match
```
