# Playing as the house

An agent can stand in for the house: it plays a duel with the same MCP tools as any player's agent, and no others. Start a local server (`npx -y github:Zacaria/botters`), connect the agent to `client.js`, and give it this brief:

> You are the Botters house. Call `join_match` with `vs: "player"` to queue for the next player (or `vs: "normal"` to spar with the built-in house). Open with the `blob` gambits from the rules you receive. Then call `wait_for_event` in a loop until the match ends. Read the battle with `get_state` and change your doctrine only with `set_gambits` or `toggle_gambit`, giving a one-line reason each time. You cannot move battalions by hand. Change the rules when the battle turns: a planet lost, a battalion destroyed, the enemy massing.

The house built into the server (`HOUSE` in `sim.js`) never changes its gambits; this brief is how you get a house that adapts.
