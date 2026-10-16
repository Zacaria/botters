# Independent lease retention repair — R1

## Candidate boundary

This is the focused repair above signed base `f7234c4b460160ec8ec5d343ac1ec3ba2bcfec02`, requested by review `t_50a7e5b8`, attachment 200 (`botters-auth-live-review-f7234c4.zip`, SHA-256 `3a42ffa111d0272754cdc37af7f1f0b4438e969351dcd3814d5b5c5450e14f16`). The replacement candidate is the signed commit containing this report; its exact SHA, tree, changed-path allowlist and binary-diff hash are recorded in the task evidence manifest and review handoff. Nothing in this repair activates accounts or authorizes deployment/provider calls.

## Behavior and implementation

The original probe reproduced R1 on the base: after the last-adopted human lease expired, the separately approved agent's first `/next` returned 401 and its retry returned `match:null`.

Capability cache entries still expire at their individual authorization deadline. The shared `session:<id>` record now uses LiveStore's bounded one-day retention on adoption rather than the last capability's deadline. Thus an independently valid agent or longer-lived human keeps the same match, side, private-room membership and private preferences after a shorter human expires.

Local account game writes previously inherited the durable account session's `ttl:0`, making those cache entries non-expiring. LiveStore now applies a one-day TTL only to those local non-expiring session writes, including normal, boundary and recovered-result commits. Durable entries retain their original TTL and transaction semantics; anonymous game writes retain their existing seven-day bound. The existing serialized sweep removes expired local entries. No blanket removal of cache expiry, no data migration and no production-data deletion are involved.

Authorization checks are unchanged: retained state cannot authorize an expired/deleted token, a deleted owner or replaced delegation; human admission still requires the bound cookie and real authority lease. Generation fencing, disconnected/stale-channel rejection, queued mutation checks and frame admission remain intact. No Convex query or mutation was added.

## Fresh isolated verification

All commands below passed on the final implementation, using the existing installed dependencies and ignored generated Convex API module:

- Original review probe: first post-expiry agent request accepted; retry retained the identical match ID. It uses synthetic authority transport around the real OnlineGame, LiveRuntime and LiveStore, not a hosted provider.
- `node --test test/live-session-retention.test.js test/live-integrity.test.js`: 11 passed. Five new tests cover private agent matches, human-only leases of different lifetimes, bounded local account cleanup with durable retention, unchanged anonymous lifetime, and token/owner deletion. Replacement delegation and missing-cookie denial are asserted while the retained match remains available to valid callers.
- `npm test`: 69 passed, zero failures/skips; includes actual stdio MCP clients, offline SSE, durable boundary failure/recovery and private-room regressions.
- `npm run test:auth:convex`: 4 passed across 3 files, executing the real Better Auth component and production proxy in convex-test; captured email only.
- `npm run test:auth:browser`: 3 passed in Brave with real library sessions, two loopback origins and Colyseus sockets. `npm run test:browser`: 7 passed, including anonymous matching/reconnect/report and private-room rematch/preferences.
- `npm run check`: passed, 67 JS files plus inline scripts/configuration. No separate lint/type/format tool is configured.
- `BOTTERS_LIVE_URL=https://play.botters.havesomecode.io BOTTERS_REQUIRE_ACCOUNT=1 npm run build`: passed. Node assertions verified the exact seven-file public allowlist and `{url:"https://play.botters.havesomecode.io",accountRequired:true}`; public asset hashes are in the evidence manifest.
- `npm audit --omit=dev --ignore-scripts --audit-level=high`: zero vulnerabilities. `git diff --check`: passed.

The new behavioral tests were first run before implementation: the agent/private-match and longer-human continuation tests failed with 401, and the bounded-account-cache test failed because expiry was zero. A final counterfactual rerun using both original runtime/store modules from the base (only relative import paths relocated into ignored cache files) reproduced the same three failures with the final five-test suite. The unchanged original review probe also failed again against those base modules. Both red and green output are retained in the evidence archive. The browser theft test's sanitized authorization error and socket close 4002 are expected evidence of rejection, not failed tests.

## Remaining gate

Next: independent delta review of this exact replacement candidate in `t_50a7e5b8`. Only after approval may the separately authorized account/provider continuation `t_d5e91f48` resume. This repair did not deploy, configure providers, send external email, access live customer data or complete that continuation. No files were deleted; the capability-derived shared-cache deadline and local immortal-account-cache behavior were replaced.

Real Google consent, external email delivery, deployed cross-host Secure-cookie acceptance, hosted reactive invalidation and the account path's hosted function-call budget remain unverified. The human authorization path still incurs the Better Auth component session/user reads identified by the review; top-level adapter counters do not count those nested calls, and anonymous eight-minute measurements do not transfer. Process loss still interrupts unfinished matches as documented in `colyseus.md`.
