# Doctrine

The doctrine is your strategy in your words. Your agent turns it into gambits and rewrites them during the match; you take a battalion in hand when it matters and give it back.

## Default doctrine

Grab the free planets near home first: they breed new units. Never charge a bigger battalion head-on: flank it while an ally holds it. Defend our planets before taking new ones. When we outnumber them, take their planets. In the last minute, hold what we have.

## Gambits

A gambit is `IF condition → action`. Every half second, each battalion not held by hand takes the first enabled rule whose condition finds something, and acts on what it found. `p` tunes a condition (defaults in brackets).

| Condition | True when → target |
|---|---|
| `planet_attacked` (350) | one of our planets within p has enemies on it → that planet |
| `bigger_enemy_near` (1.3) | an enemy battalion at least p× our size within 180 → that enemy |
| `weaker_enemy_near` (0.8) | an enemy battalion at most p× our size within 260 → that enemy |
| `ally_fighting` (450) | we are not fighting and a friendly battalion within p is → the enemy it fights |
| `small` (120) | this battalion has fewer than p units → the nearest friendly battalion |
| `big` (900) | this battalion has more than p units → itself |
| `free_planet` (2000) | an unowned planet within p → that planet |
| `enemy_planet` (2000) | an enemy planet within p → that planet |
| `always` | always → itself |

| Action | What the battalion does |
|---|---|
| `go` | moves to the target: attacks the enemy, takes or defends the planet, merges into the friend |
| `flank` | swings wide round the enemy target and hits it from the side |
| `retreat` | falls back to the nearest friendly battalion at least half its size, else our nearest planet |
| `split` | splits in two; the new half heads for the second-nearest planet we do not own |
| `hold` | stops where it is |

## Who changes what

- The agent reads the battle (`get_state`, `wait_for_event`) and changes only the rules: `set_gambits` and `toggle_gambit`, each with a one-line reason.
- Hand orders (move, flank, detach, release) are the human's. The agent asks for one with `call_human`; the server refuses hand orders from an agent token.
- The match journal, at the bottom of the panel on your camp's side, lists every doctrine edit (✎): time, author, which rule changed, and why. The Gambits section shows how many battalions follow each rule.

## House doctrines

`sim.js` `DOCTRINES`: `cautious` (easy), `blob` (normal: never retreats, never splits), `pincer` (hard: blob that flanks an equal or bigger battalion), `flanker` (every side's starting gambits). Measured strength: pincer > blob > flanker > cautious (`docs/agent-value/RESULTS.md`). Retreating from bigger battalions loses: no measured set that retreats beats one that does not.
