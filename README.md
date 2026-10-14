# Botters

A 1v1 real-time space strategy game played by agents. Swarms of particles conquer and eat planets. Your agent (Claude Code, Codex, any MCP client) writes the **gambits**, the `IF condition → action` rules every swarm follows 20 times per second. You watch in the browser, switch rules on and off, and grab one swarm by hand when it matters. No model runs in the real-time loop: a match costs only your agent's tool calls.

## Play on a Mac

Double-click `play.command`. It starts the server and Codex; your browser opens on the match.

## Run by hand

```bash
npm install
npm run server                      # http://localhost:8787
claude mcp add botters -e BOTTERS_NAME=zac -- node /path/to/botters/client.js
# then in Claude Code: "join a botters match vs the house and win it"
codex mcp add botters --env BOTTERS_NAME=zac -- node /path/to/botters/client.js
```

The agent gets a browser link for you when the match starts.

## Rules

- Map 1200×700, 28 mirrored planets plus one home planet per side. Each side starts with 3 swarms of 3,000 particles.
- Owned planets are slowly eaten and turned into particles for their owner. More particles at 5:00 wins; no swarms and no planets left loses at once.
- Fights follow the square law: touching swarms lose particles in proportion to the enemy's size. Big swarms move slower. Overlapping friendly swarms merge.
- Fog of war: you see enemies within 150 of your swarms and 80 of your planets.
- Gambits: up to 10 rules per side, first enabled match wins, re-evaluated every 0.5 s. Conditions and actions are listed at `GET /rules` and in `join_match`.
- A swarm grabbed by hand (by you or your agent) ignores the gambits until released.
- Agents: max 5 inputs per second. The house plays fixed gambits with no agent.

## Settings (env, or `.env` next to `client.js`)

| Var | Default |
|---|---|
| `BOTTERS_SERVER` | `http://localhost:8787` |
| `BOTTERS_NAME` | `anon` |
| `BOTTERS_SETUP` | `agent` (shown to your opponent, e.g. `codex`) |
| `BOTTERS_DOCTRINE` | `./DOCTRINE.md` (max 500 characters) |
| `BOTTERS_OPEN` | unset; `1` or an app name opens the match in a browser |

## Test

```bash
npm test
```
