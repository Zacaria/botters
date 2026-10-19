# Agent reapproval recovery implementation plan

> For agentic workers: use superpowers:executing-plans for this single inline repair task, with test-driven-development and a fresh whole-branch review. The assigned card authorizes bounded implementation, not a new human design approval.

Goal: after a definitive agent-capability refusal, forget only that connection's local match state and guide the agent to join_match for fresh explicit player approval, without restarting MCP or changing the match.

Architecture: reuse client.js api/session/need and the existing approval protocol. Handle capability 401 and pairing-poll 410 at the shared transport boundary, with request-session identity guarding invalidation. Do not retry or pair automatically. Existing tools and schemas stay unchanged.

Tech stack: Node 22.23.3, existing MCP SDK/Zod, node:test, OnlineGame/MemoryStore and scripts/auth-dev.js fixtures; no new dependencies.

Spec: task t_22bbf0ec, its BINDING.json and NEXT-SUPERPOWERS-SCOPE-AFTER-PR9-3ea5ad07.json; AGENT-REAPPROVAL-VERIFICATION-SCOPE.json overrides the earlier broad UI replay requirement.

## Global constraints

- Base 3ea5ad0738441c1ce696fc07e8d73b4e74a0fc0c; base tree 618d8d8189d45b315a472d0aa7f5439e630b930c.
- Only client.js, test/mcp-auth.test.js and this note may change in committed source.
- No backend, permission, installer, doctrine, asset, account-state or history changes; no profiles, providers, real accounts, publication, merge or deployment.
- Fixture players only, explicit approval via the existing route, loopback only, BOTTERS_OPEN=0, explicit BOTTERS_SERVER. Never retain raw capabilities or human identifiers in evidence.
- Reuse readonly dependencies; serialize fixture execution with the bound shared lock and use the bound isolated HOME and short TMPDIR.
- Existing linked worktree was verified; dependencies/public symlinks were supplied, not installed or replaced. Baseline npm test: 129 passing, zero failures.

## Acceptance and review focus

1. A capability 401 from events, any input tool or call_human clears session/opened/inMatch/matchId/since and returns join_match guidance, not a false match-over message. Subsequent actions must not send the refused capability.
2. The same reset covers join_match's next/poll refusal and pairing expiry (410 on poll only), including an agent token provided at process startup.
3. An explicit join_match requests a fresh approval; pending approval prohibits all gameplay tools. Explicit fixture-player approval allows the same MCP process to resume the same match and act. Preserve rules, doctrine, match and history.
4. Initial POST /session 401 is normal pairing initiation. Capability 403/409/429/5xx and transport failures must not erase the session or silently request approval. Non-poll 410 is not pairing expiry.
5. A delayed refusal for an older session must not erase a newer connection, including a new pending approval. Concurrent already-in-flight requests cannot be recalled, but no subsequent action may send a locally rejected token.

## Task 1: Coherent capability invalidation

Files: modify client.js and test/mcp-auth.test.js; create this note.
Interfaces: api(method, path, body) remains the shared JSON transport; session() and need() retain their existing responsibilities; all seven MCP tools retain their names and schemas.

- [ ] Step 1: Extend the existing two-process MCP test: revoke an agent during the real accelerated match, assert join_match guidance, block every action while disconnected/pending, explicitly reapprove and resume the same match with a successful action and final history.
- [ ] Step 2: Add deterministic callback-level tests using the actual client callbacks and OnlineGame/MemoryStore, with only transport faults/delays controlled: cover events/input/call/next/poll refusal, real expiry, all input siblings, transient status discrimination and late old refusals. Assert coherent local state as well as observable tool behavior; never implement authorization in a fake.
- [ ] Step 3: Run node --test test/mcp-auth.test.js before modifying client.js. Expected: assertion failures for missing guidance/state invalidation, including the real process test. Keep RED output without raw tokens.
- [ ] Step 4: In api capture the request's session identity, invalidate only on a token-bearing capability 401 or pairing-poll 410, replace the error with safe join_match guidance and reset all five local fields only when that exact session remains current. Reuse this result in join_match instead of its partial resets. No automatic pairing/retry and no generic connection manager.
- [ ] Step 5: Run the same test. Expected: all passing; verify discrimination tests do not cause pairing or erase state. Run affected accounts/live-account/online regressions too.
- [ ] Step 6: Run npm test, npm run check and npm run build. Expected: zero failures; record actual totals. UI/browser/auth-Convex campaigns are not replayed locally under the bound verification override; do not claim their results.
- [ ] Step 7: Fresh whole-branch code review, resolve important findings with RED/GREEN, make scoped signed commit, verify a recoverable local Git bundle and exact candidate/tree. No push/PR/merge/deploy. Hand off to the coordinator for independent Luna/Sol gates.

## Investigation and decisions

All api callers were traced: session/pair, poll, play, next, rules, events, shared input (set_gambits/order_swarm/split_swarm/release_swarm) and call_human. All gameplay tools use need(). The base api returns HTTP status but leaves state untouched; join_match alone clears session/opened on selected refusals, leaving inMatch/matchId/since stale. Backend revocation already increments agentVersion; no backend fix is needed.

Ruling: keep this plan and execution record in the one permitted contribution note instead of creating another tracked plan path. Skill scratch remains ignored and local; evidence is retained separately for the requested handoff. Cost if wrong: documentation organization only.

Ruling: use the card's fixed implementation description as the binding scope and execute inline; do not fabricate interactive human approval in a headless assigned run. New design decisions beyond that scope require recadrage. Cost if wrong: coordinator must reject or refine this local candidate before integration.

## Executed verification

Native session 20261019_121752_71820a, kanban run 967; model gpt-6.1-sol / openai-codex, method contrib-superpowers. No provider billing totals are inferred.

- Baseline npm test: 129 tests passed, zero failed.
- Corrected-fixture RED, with client.js unchanged from base: node --test test/mcp-auth.test.js exited 1; 19 tests, 7 passed, 12 failed. The actual process test reached genuine revocation and failed because its response omitted join_match guidance. Deterministic checks also caught stale inMatch and missing guidance across every sibling input path.
- First RED also caught an inherited fixture weakness: hunt is not a simulation action, but the prior test checked only MCP isError. The fixture now uses valid hold and requires gameplay ok:true; the corrected RED was rerun before any product change.
- Initial focused GREEN: node --test test/mcp-auth.test.js test/accounts.test.js test/live-account.test.js test/online-regressions.test.js exited 0; 29 tests passed. Subsequent test strengthening adds explicit rules/doctrine preservation, poll-410 stale-state reset and startup-supplied token coverage.
- Whole npm test on that strengthened candidate: exited 0; 149 tests passed, zero failed/cancelled/skipped. The existing Node command includes its own browser-based regressions, which were not excluded. Real MCP reapproval uses an eight-minute fixture match so the existing 20-second approval poll at simulation clock ×10 does not end it before resumption; no fixture clock/backend changes.
- npm run check exited 0: syntax checked 81 JS files, inline browser scripts and JSON; no separate lint/type/format tool is configured. npm run build exited 0: built 8 public assets and the live browser bundle into the supplied worktree-specific public symlink target.
- One earlier full-suite attempt timed out at 240 seconds with partial output and no verdict; a separate negative-name-filter diagnostic also timed out and is not treated as verification. The fresh whole-suite rerun above completed with exit 0. Both incomplete attempts are retained in evidence, not silently counted as passes.
- Not replayed locally: npm run test:browser, npm run test:auth:browser and npm run test:auth:convex, per AGENT-REAPPROVAL-VERIFICATION-SCOPE.json. UI/auth/backend/installer sources remain byte-identical to the bound base. No claim about new CI, compatibility with hosted clients, or rendered independent Sol approval.

The only product change is shared transport invalidation (plus join_match consuming its safe errors). Requests already in flight cannot be recalled; identity-guarded refusals cannot wipe a newer connection. No automatic approval, new permission, server mutation, retry loop or token persistence was introduced. Independent code review, exact signed commit/tree and verified recovery bundle are recorded in the local handoff manifest; coordinator-owned Luna/Sol and integration remain gates, not claims made by this note.
