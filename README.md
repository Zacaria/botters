# Botters (spike)

A 1v1 real-time strategy game played by agents. A fast decision model (the **pilot**) orders every unit several times per second. Your LLM agent (the **commander**: Claude Code, Codex) steers the pilot. You (the **human**) watch in the browser and fire the decisive abilities.

## Run

```bash
npm install
npm run server                      # http://localhost:8787
```

Play as commander from Claude Code (pilot = Jev, key read from TYPESAFE_API_KEY):

```bash
claude mcp add botters -e BOTTERS_NAME=zac -e TYPESAFE_API_KEY=$TYPESAFE_API_KEY -- node /path/to/botters/client.js
# then in Claude Code: "join a botters match and win it"
```

Codex:

```bash
codex mcp add botters --env BOTTERS_NAME=zac --env TYPESAFE_API_KEY=$TYPESAFE_API_KEY -- node /path/to/botters/client.js
```

Pilot only, no commander (testing):

```bash
node client.js --auto
```

The client prints a browser URL. Open it to watch your side, ping, give orders and use abilities.

## Client settings (env)

| Var | Default |
|---|---|
| `BOTTERS_SERVER` | `http://localhost:8787` |
| `BOTTERS_NAME` | `anon` |
| `BOTTERS_PILOT_URL` | `https://api.typesafe.ai/v1/systemone` |
| `BOTTERS_PILOT_MODEL` | `jev-latest` |
| `BOTTERS_PILOT_KEY` | `$TYPESAFE_API_KEY` |
| `BOTTERS_DOCTRINE` | `./DOCTRINE.md` (max 500 characters) |

Local Clef-flash: `BOTTERS_PILOT_URL=http://gamer-ethernet.lan:11434/v1/systemone BOTTERS_PILOT_MODEL=clef-flash:q4_k_m` (needs Ollama ≥ 0.35.0).

## Rules

- 40×24 grid, fog of war. Bushes hide units unless an enemy is within 1.5 tiles. Attacking from a bush reveals you for 1 s.
- Units: fast beats ranged, ranged beats tank, tank beats fast (×1.75 damage). Miners earn resources and cannot fight. Start with 12 units; resources buy reinforcements.
- 3 control points. Each held point scores 1/s. Win at 200 points, by wiping the enemy, or by leading after 5 minutes.
- Human abilities (browser only): strike (area damage, 45 s), overdrive (+50% speed 5 s, 60 s), recall miners (60 s), reveal map (3 s, 45 s). The agent can call for one.
- Max 5 order batches per second per player. Orders apply on the next server tick: latency costs you.

## Test

```bash
npm test
```
