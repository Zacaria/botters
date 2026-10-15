# Botters

A 1v1 real-time space strategy game you play **with your AI agent**. Swarms of particles conquer and eat planets. Your agent (Claude Code, Codex, any MCP client) writes the **gambits**, the `IF condition → action` rules every swarm follows. You write the doctrine, edit the gambits, switch rules on and off, and grab one swarm by hand when it matters. No model runs in the real-time loop: a match costs only your agent's tool calls.

## Play

Online home: https://botters.vercel.app. Select **Play online** for matchmaking, or **Create room** and share its code/link. House modes still run locally without this server. The `pvp-online` candidate needs a configured Convex store before online play is available; see `docs/pvp-spec.md` and `docs/pvp-release.md` for the verified release state.

For online MCP play, point your agent to the public server and open the private lobby it returns:

```bash
claude mcp add botters -e BOTTERS_SERVER=https://botters.vercel.app -- npx -y github:Zacaria/botters#pvp-online
codex mcp add botters --env BOTTERS_SERVER=https://botters.vercel.app -- npx -y github:Zacaria/botters#pvp-online
```

Each player keeps their own agent subscription/model keys. Botters never runs inference. Share only the room link; your personal lobby link is a bearer capability. Reloading the same browser resumes a match. Names/setup labels are not authenticated identities, so Elo is casual.

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
BOTTERS_SERVER=https://PREVIEW_URL npm run test:online # two real stdio MCP clients, full wall-clock match
```
