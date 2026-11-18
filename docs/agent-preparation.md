# Prepare the agent before starting a match

## Accepted flow

The human chooses settings and doctrine in the lobby and explicitly requests preparation. There is no match or countdown during preparation. The approved agent reads that request through `join_match`, saves its opening through `set_gambits`, and can finish its assistant turn. The lobby shows the saved rules and explanation. Only the human starts online play. Saved opening rules run from tick zero even if the assistant is no longer polling.

## Protocol

- Human `POST /prepare` takes the existing play options. Persist `session.preparation = { id, options, doctrine, agentVersion, gambits: null, why: '' }`; do not create or queue a match. Refuse during an active match or queue. Options are canonical mode/vs/minutes/planets/planning, excluding the human's opening. Room preparation uses current shared room settings plus that member's own agent preference. Only the human can request preparation.
- Agent `GET /next` returns `{ match: null, preparation }` immediately while an unstarted preparation exists. A current active match still takes precedence. HTTP long polling must stop on a preparation response. The preparation includes the doctrine/settings but no other player's private plan or hidden map.
- Reuse agent `POST /input` with `{ preparationId, gambits, why }` to save an opening outside a match. Validate the current request ID, doctrine, agent version and real gambit semantics before storing canonical rules. Only the agent may mark its opening ready. Stale responses fail without changing the newer plan. Other gameplay actions remain match-only.
- Human `GET /lobby` includes its own preparation and computed `ready`. A saved opening remains usable after presence expires, but revocation/reapproval or changed doctrine invalidates it. Changed settings must not silently use an old plan. Failed writes never display ready.
- Human starts using the existing `/play` or room start/rematch routes. An explicit agent-led opening (`withAgent: true`, no manual `opening`) requires a matching saved preparation. New play requests default to solo unless `withAgent` is explicitly true; the MCP offline headless caller opts in explicitly and remains allowed to start locally. Apply a prepared opening at tick zero as an **agent** input, preserve its reason and mark `openingBy: 'prepared'`. Validate before queue or room mutation. A private room's plans remain private. Solo play and human-written openings do not need preparation.
- `join_match` returns the preparation with rules immediately and tells the agent to call `set_gambits`, then tell the human the opening is ready. It must not invent live-model readiness. `set_gambits` carries the remembered preparation ID when not in a match; active match behavior stays unchanged. No new MCP tool or model-running service is needed.

## Shared code and verification

Use one small `agent-preparation.js` helper for the real offline and online call paths: `createPreparation(session, options, id)` returns the record; `preparationReady(session, options = session.preparation?.options)` checks saved gambits, doctrine/version and canonical settings; `savePreparation(session, { preparationId, gambits, why })` validates and stores rules or throws a status-bearing 400/409 error. Backends retain authorization and start authority. Do not trust client-supplied ready/source flags.

Test the full prepare → save → human start flow without an active agent, stale doctrine/settings/request IDs, revocation/reapproval, failed gambits, solo/manual starts, room privacy/start/rematch, and offline headless behavior. LiveRuntime adoption and durable LiveStore merges must retain preparation safely across separate human and agent authority channels. Run real SDK children and a rendered browser journey; independent Sol review of the candidate's actual UI/interactions is required before handoff. Implementation is separate from production deployment.
