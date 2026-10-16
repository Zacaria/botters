# Botters

A 1v1 real-time space strategy game you play **with your AI agent**. Swarms of particles conquer and eat planets. Your agent (Claude Code, Codex, any MCP client) writes the **gambits**, the `IF condition → action` rules every swarm follows. You write the doctrine, edit the gambits, switch rules on and off, and grab one swarm by hand when it matters. No model runs in the real-time loop: a match costs only your agent's tool calls.

## Play

Sign in at https://botters.havesomecode.io with Google or a verified email/password account. Select **Play online** for matchmaking, or **Create room** and share its code/link. The older https://botters.vercel.app address remains public and links to owned-domain sign-in. House modes still run locally without an account.

Point your agent to the public server and approve its connection in your signed-in browser:

```bash
claude mcp add botters -e BOTTERS_SERVER=https://botters.havesomecode.io -- npx -y github:Zacaria/botters#pvp-online
codex mcp add botters --env BOTTERS_SERVER=https://botters.havesomecode.io -- npx -y github:Zacaria/botters#pvp-online
```

Each player keeps their own agent subscription/model keys. Botters never runs inference. The agent opens a ten-minute approval link; connect it explicitly, then start matches yourself. It receives no human/account token. Disconnect it in the lobby to revoke its seven-day grant. Signing in on another device resumes your account, room and recent history. Verified-account Elo is separate from old name-only ratings; names are not merged or adopted. Elo remains casual, not proof of identity. See `docs/auth.md` for configuration, privacy and release prerequisites. This branch's auth increment is a candidate until its provider checks and release handoff are satisfied; live production status is recorded in `docs/public-pages-release.md`.

```bash
claude mcp add botters -- npx -y github:Zacaria/botters     # Claude Code
codex mcp add botters -- npx -y github:Zacaria/botters      # Codex
```

Then tell your agent "let's play Botters". It starts the game on your machine and opens your lobby. No agent yet? `npx -y github:Zacaria/botters` opens the game to play alone. Requires Node 22+. Other MCP clients: see `/guide`.

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
2. In the lobby you write the **doctrine** (your strategy in your words, 500 characters) and pick the opponent (house easy / normal / hard, or another player), the length (3 / 5 / 8 min), the map (16 / 28 / 40 planets), the planning countdown, and who writes the opening gambits.
3. **Play**: your agent receives the doctrine and writes the opening gambits during the countdown.
4. In the match, the panel shows who last wrote the gambits and why; new rules flash. You can edit the gambits, switch rules (click, 1–0), change the doctrine, message or ping your agent, and grab swarms. Each of your actions reaches your agent as a `HUMAN …` event.
5. End screen: the same match replayed without your actions and without your agent's, then **Play again**. The lobby lists your last 10 matches.

## Rules

- Map 1200×700, mirrored planets plus one home planet per side. Each side starts with 3 swarms of 3,000 particles.
- Owned planets are slowly eaten and turned into particles for their owner. Most particles at the end wins; no swarms and no planets left loses at once.
- Fights follow the square law: touching swarms lose particles in proportion to the enemy's size. Big swarms move slower. Overlapping friendly swarms merge.
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
npm run test:browser       # two isolated Brave contexts; local accelerated clock, no live data
npm run test:auth:browser  # real Better Auth + captured test mail, isolated loopback only
npm run test:auth:convex   # actual Convex component + proxy, isolated test database
BOTTERS_SERVER=https://PREVIEW_URL npm run test:online # two real stdio MCP clients, full wall-clock match
```
