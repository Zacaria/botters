# Rounds with breeds (preview only)

A rounds match is 5 rounds against the house on one map. Before each round there is a pause; during the pause you, your agent, or both rebuild your bot. Then the round is fought by the bots alone and replayed in the browser. More rounds won wins the match. Measured design: `docs/agent-value/RESULTS.md` §4–§5.

The mode exists only where the Worker variable `ROUNDS_ENABLED` is `"1"` (the `preview` environment in `wrangler.jsonc`). Production does not set it: the lobby shows no Rounds card, `/rounds*` answers 404 and the MCP connector lists no rounds tools. Live matches never use breeds.

## Rules

- A bot is a **breed** plus **rules** (gambits). The whole starting army is that one role (1200 units in three battalions) and your planets breed it. Runner beats tank, tank beats grunt, grunt beats runner: ×2 damage on the prey, ×0.5 on the predator (`ROUNDS.counter`).
- Rule slots: 3 for round 1, +1 after each round, +1 more for the loser of the round, at most 10.
- Pause: 60 s. The last valid bot sent before the gong plays; without one, the previous bot plays (round 1: `START` in `rounds.js`). The human can ring the gong early with **Fight**.
- A round is 75 s of combat, simulated by the server at the gong and replayed by the browser at 5× (15 s). The next pause opens when the replay ends.
- The house plays `pincer` trimmed to its slots, with a breed drawn from the seed. It keeps a bot that won; after a lost round it switches to the breed that beats the one that beat it. It never sees your next bot.
- After each round the debrief shows both armies (breed, units per role at start and end), planets and units every 15 s, and how often each of your rules decided.

## HTTP (`?token=` human or agent token)

| Route | Who | Does |
|---|---|---|
| `GET /rounds` | human, agent | `{ available: true, match }`; `match` is `null` or the state below |
| `POST /rounds/start {breed}` | human | starts a new match (abandons a running one) |
| `POST /rounds/bot {round, breed?, gambits, why}` | human, agent | replaces the bot for this pause; 400 with one sentence listing every problem |
| `POST /rounds/ready {round}` | human | rings the gong now |
| `POST /rounds/leave` | human | abandons the match |

`match`: `{ id, seed, planets, phase: 'pause'|'fight'|'over', round, of, score: {you, house}, slots: {you, house}, secondsLeft, bot: {breed, gambits}, versions: [{at, who, breed, rules, why}], refused: [{at, who, error}], fight: {round, bots: [yours, house], seconds, counter, planets, msLeft} | null, rounds: [debrief], result }`. A debrief is `{ round, result, reason, endedAt, planets: {you, house}, units: {you, house}, timeline, yourArmy: {breed, atStart, atEnd}, houseArmy: {breed, atStart, atEnd}, yourRules: [{rule, share}], bots: [yours, house] }`. The browser rebuilds a round with `roundMatch(seed, bots, {seconds, planets, counter})` from `sim.js` and steps it.

## MCP

With rounds enabled, the connector adds `wait_for_pause` (blocks until the next pause or the end, returns the debrief of the last round) and `set_bot` (`round`, `breed`, `gambits`, `why`). Versions from the agent appear in the human's editor with their reason; the human can overwrite them until the gong.

## Preview

`npx wrangler deploy --env preview` deploys Worker `botters-play-preview` with its own D1 `botters-play-preview` (fresh accounts, email sign-in only) at its workers.dev address. It never touches `play.botters.havesomecode.io`.
