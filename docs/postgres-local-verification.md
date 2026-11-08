# PostgreSQL local verification

This pilot uses Better Auth's migration runner and `PostgresStore.init()`. It does not migrate existing accounts or establish compatibility with Convex identities, credentials, sessions, or history. Never use this procedure with a shared or production database or real personal data.

## Prerequisites and isolation

Use Node 22+ and PostgreSQL on the same machine. Install dependencies with `npm ci`. Create a new disposable PostgreSQL cluster bound only to loopback, with a unique data directory and port. For example, using locally installed PostgreSQL tools:

```sh
WORK=$(mktemp -d)
initdb -D "$WORK/data" --auth-local=trust --auth-host=trust
pg_ctl -D "$WORK/data" -l "$WORK/log" -o "-h 127.0.0.1 -p 55481 -k $WORK" -w start
createdb -h 127.0.0.1 -p 55481 botters_synthetic
export BOTTERS_TEST_POSTGRES_URL=postgresql://"$(id -un)"@127.0.0.1:55481/botters_synthetic
```

Use an unused port and a new cluster; trust authentication is acceptable only for this temporary isolated cluster. Protect its directory and stop it promptly. After creation, provide the build identifier required by the real live entry point before running the concurrent test suite. In a clean checkout, `node -e "require('fs').writeFileSync('build-id.json', JSON.stringify({commit:'isolated-test'}), {flag:'wx'})"` creates a synthetic identifier without overwriting an existing file; remove only that test-created file after the run. Then run `npm test` directly: no tables or preliminary migrations are required in `public`; each PostgreSQL integration test creates its own random schema and initializes the project components it needs using the real Better Auth migration runner and/or `PostgresStore.init()`. The test database user must be able to create and drop schemas. To run only the live-entry and concurrent-auth checks, use `node --test test/postgres-live-entry.integration.test.js test/postgres-auth-concurrency.integration.test.js`. Do not run separate test suites concurrently against the same worktree because the live-entry test temporarily creates `build-id.json`. Do not store credentials in this document or a repository file. Tests require `BOTTERS_TEST_POSTGRES_URL` to be an explicit loopback URL. Better Auth uses a synthetic `BETTER_AUTH_SECRET` and `SITE_URL` inside the test; email stays in memory. No Resend or external service is used.

## Migrations and synthetic fixtures

```sh
node --test test/postgres-schema.integration.test.js
node --test test/postgres-live-exchange.integration.test.js
```

The first test creates a random schema in the empty disposable database, runs Better Auth migrations and record-store initialization twice, checks constraints and relations, and creates two distinct verified synthetic accounts using Better Auth. The second exercises the existing two-account fixtures and cross-account rejection in the isolated ticket and authority primitives. Ticket exchange accepts a durable game-owner record without an expiry, but still requires expiring tickets and human capabilities. The schemas are dropped on normal test shutdown; an abrupt termination may leave synthetic schemas. The migration runner's second invocation is verified against the resulting schema; this is not a promise that arbitrary manual DDL or production upgrades are idempotent.

Stop the cluster you created with `pg_ctl -D "$WORK/data" -m fast -w stop`. Never reset or delete a database without authorization, or remove someone else's directory.

## Live authority response semantics

A fresh authority result that confirms a missing or revoked capability is an authentication refusal (401), not a backend outage. A failed or stale authority read remains unavailable (503). Revocation propagates on the polling interval and is not instant; the lease must never outlive a successful database read. PostgreSQL pool idle-connection errors must not terminate the control or live process; live authority requests still fail closed while the backend is unavailable. These semantics alone do not prove the browser journey.

## PostgreSQL HTTP control entry point

The local Node control entry point is `node scripts/postgres-http-server.js`. Configure `DATABASE_URL`, a nonempty `BOTTERS_STORE_NAMESPACE` shared with the live server, `SITE_URL`, `BOTTERS_AUTH_ORIGIN` (the same exact origin), and `BETTER_AUTH_SECRET` (at least 32 characters). It checks existing schemas before listening and does not run migrations. Run it only against an isolated synthetic database for this verification. Email delivery uses the existing delivery adapter and must not be invoked without separate authorization; tests inject captured mail instead. This local candidate is not a deployment or a migration of existing accounts. Proxy headers are not trusted for client IP by this entry point. The existing Convex entry point remains the default export.

## PostgreSQL live-server entry point

The real Colyseus entry point supports `BOTTERS_LIVE_BACKEND=postgres`, with `DATABASE_URL` and a nonempty `BOTTERS_STORE_NAMESPACE` shared with the HTTP store. Set exact `PLAYER_ORIGINS`, `BOTTERS_REQUIRE_ACCOUNT=1`, and run `node scripts/live-server.js`. The deployment build supplies `build-id.json` with a `commit` field; local tests create a temporary synthetic one if absent. The process checks the existing record and Better Auth tables before listening; run the migrations separately first. It does not create or migrate tables at startup. Keep the database URL private. `node --test test/postgres-live-entry.integration.test.js` creates and initializes its own random schema on the dedicated loopback database, launches the actual entry point, checks health and shutdown, and removes that schema on normal teardown. It does not require public tables. This live entry point alone does not wire the HTTP authentication service or establish the end-to-end journey.

## Verification on the isolated candidate

On PostgreSQL 17.11, a new loopback-only cluster and `botters_synthetic` database started with zero public tables. With `BOTTERS_TEST_POSTGRES_URL` set to that database:

- `node --test test/postgres-schema.integration.test.js test/postgres-live-exchange.integration.test.js`: 2 passed, none skipped. The first attempt exposed a test assumption: verification also created sessions; the corrected query selects the two actual login sessions.
- `npm test`: 266 passed, none skipped.
- `npm run check`: passed; the project declares no separate lint, type or formatter tool.
- `npm run build`: passed, producing 10 public assets.
- `npm run test:auth:convex`: failed because `convex/_generated` is absent. Remote Convex code generation was not run.

The tests removed their random schemas. This verifies the existing pilot schema on an empty local database, not a production account conversion or a fully wired game server.

## Integrated candidate observation

With a distinct local PostgreSQL 17.11 cluster, the journey test was also run with both actual-entry flags from the fixture README. Synthetic verification and reset messages were intercepted before network access. The test exercised two accounts, reset and prior-session revocation, control and live restarts, a one-winner ticket race, live gameplay and WebSocket frames, account isolation, real interprocess revocation, and a live-to-database TCP cut followed by 503 and recovery. One local run observed 401 in 424.0 ms and WebSocket closure in 424.2 ms after revocation, including subprocess startup; 48 parallel requests took 81.5 ms. These are individual observations, not availability, capacity, latency or instant-revocation guarantees.

**Additional observed outage failure (8 November 2026):** A fresh full-suite replay failed `postgres-control-outage.integration.test.js`: the real control process exited after the proxy cut its PostgreSQL sockets. Focused replays reproduced the intermittent exit (three passes and two failures across five attempts); stderr identified an unhandled `pg` Client `error` event, `Connection terminated unexpectedly`. The client ownership and exact timing have not been established, and survival of this cut must not be claimed as guaranteed. This observation is separate from the four unidentified historical failures.

Before the idle-pool error handlers, the same TCP cut caused both actual entry processes to exit with an unhandled PostgreSQL pool error. The live journey and a separate control-process idle-socket test now cover their survival. This control test does not establish all HTTP outage or recovery semantics. The four historical failures referenced in comment 2139 remain unidentified, so they have not been replayed. The Convex integration command still needs the absent generated Convex files; no remote code generation was attempted. Browser behavior, real email delivery and production migration remain outside this verification.


## Outage verification scope

The interprocess journey exercises both actual entry points with an already-open authenticated WebSocket during simulated independent TCP cuts to PostgreSQL. A nonnumeric Better Auth error status must produce a sanitized 503 without terminating the control process. Test deadlines are ceilings, not service guarantees; requests and frames already in flight may complete, and no instantaneous revocation is claimed.

Run the fault test separately because its additional signup otherwise exceeds the shared five-signup test budget:

```sh
BOTTERS_TEST_BROWSER_OUTAGE=1 npx playwright test -c playwright.postgres.config.js --grep 'browser outage'
npx playwright test -c playwright.postgres.config.js
```

Both commands require the dedicated `BOTTERS_TEST_POSTGRES_URL` defined above. The fixture cuts only the selected process-to-database loopback proxy; it does not stop PostgreSQL. Restore and schema cleanup run in `finally` and fixture shutdown. Never expose this test-only fixture to an untrusted network.

### Local observations, 2026-11-08 UTC

The run used an empty, dedicated local PostgreSQL 17 cluster, synthetic identities and the real control/live entry points. Browser tests used Brave through the fixture's loopback TLS proxies. The following are individual observations, not service-level limits:

| Scenario and expectation | Observed |
| --- | --- |
| Control database cut: authenticated HTTP fails closed, process survives and recovers | `/session` 503; live lobby still 200; control `/account` 200 after restore. Before the fix, Better Auth's `INTERNAL_SERVER_ERROR` string caused Node `ERR_HTTP_INVALID_STATUS_CODE` and process exit 1. |
| Live database cut in Brave at 03:01:39.759 | Six WS frames arrived after injection before closure at 543 ms; none during the next 400 ms. Lobby returned 503, then 200 after restore; reload resumed frames. |
| Browser sign-out, 24 concurrent lobby requests and active WS | 24 returned 200 while racing; seven frames observed before closure at 566 ms from initiating sign-out. Preserved old account/live cookies and bearer were eventually refused (401), checked at 1444 ms from start. These requests were not synchronized against the database commit. |
| Direct session deletion in separate process, 24 concurrent HTTP requests | All 24 returned 200 during the race; one frame arrived. HTTP 401 and WS close 4003 observed at 310.3 and 310.4 ms from starting the deleting subprocess. This includes subprocess startup, not a commit-to-effect measurement. |
| Password reset after outage recovery, 24 concurrent HTTP requests and an open WS | All 24 returned 200 during the race; four frames observed; WS close 4003 at 345.8 ms from reset start including password hashing. Old HTTP/live credentials returned 401, reset token replay returned 400, and the new password signed in. |
| Rate budget: 20 simultaneous synthetic sign-ins across two real control processes with forged forwarding headers | The earlier fixture's Node fetch rewrote the supplied Host to each destination port. Requests to the second process therefore hit the origin guard and returned 400, not an authentication refusal. With the common authority sent using raw HTTP, five received invalid-credential 401 and fifteen received 429; the test separately verifies the origin guard's 400 response. This verifies the outer guard for the tested topology, not independent Better Auth database counter atomicity. |
| Unaffected valid authority load | 48 concurrent lobby requests succeeded in 91.8 ms; this is a bounded smoke test, not capacity qualification. |

The authority refreshes every 500 ms and leases successful snapshots for at most 2000 ms from refresh start; failed refreshes fail closed. A successful later refresh clears the preceding error only after the replacement snapshot has been adopted. HTTP checks authority again at execution and WS frame admission rechecks the cached authority, but a previously validated request or queued frame can finish before a refreshed revocation is adopted. Scheduling, DB latency and network buffering add uncertainty; neither these timings nor the test deadlines establish instantaneous or maximum production propagation. The public control exposes sign-out and password reset; the direct database deletion is an additional cross-process test, not a public endpoint. Agent revocation is a distinct capability and is covered by the regular browser scenarios.

**Immediate post-commit revocation: NOT PROVEN / NOT MET by the cache.** The isolated PostgreSQL exchange test deliberately suspends polling using a 60-second interval, waits for a separate process's session deletion to commit and exit, then observes that a fresh database authorization denies the grant while the cached authority remains connected and retains it. An explicit refresh then removes it. This is a deterministic counterexample to treating the cache as a post-commit barrier, not a measurement of the normal 500 ms poll or a direct HTTP/WebSocket post-commit test. The existing endpoint races above have no commit barrier and cannot establish that guarantee for logout or password reset either. Preventing all post-commit effects would require coordination of the durable revocation commit with admission and in-flight effects, including outbound frames and already queued data; merely querying or notifying before an effect leaves a race. No such coordination has been implemented or qualified here.

The race runs start operations concurrently but do not hold individual requests at a barrier around the actual commit, so they do not prove every possible interleaving. They do not model a stalled rather than disconnected database, production load, multiple hosts, an external ingress, TLS trust or real email delivery. The final real-entry full Node suite passed 273/273. After testing, the dedicated cluster had zero `botters_%` schemas, stopped cleanly, all five loopback test ports were unbound, and the synthetic build ID was absent. No push, migration of existing data, cutover or deployment is authorized by these observations.

## Real-entry browser verification

The real-entry browser harness starts `scripts/postgres-http-server.js` and `scripts/live-server.js` as separate processes against a newly initialized random PostgreSQL schema. A loopback-only HTTPS static website proxy supplies browser assets and forwards all control requests unchanged; a second HTTPS proxy forwards HTTP and WebSocket traffic to the real live process. Neither implements authentication or live authority. The harness generates a short-lived self-signed certificate and Playwright ignores certificate errors only for this isolated test. Outbound synthetic email is intercepted in the control process. Run `BOTTERS_TEST_POSTGRES_URL=... npx playwright test --config=playwright.postgres.config.js` against a dedicated loopback test database and installed Brave. Its mail and storage observation endpoints are test-only; never expose the harness. The normal teardown stops the child processes and drops only the random schema; interruption can leave a synthetic schema.

Comment 2139 identifies symptom groups, not four named scenarios: sign-out initially returns 200, absent/revoked authority returns 503 rather than 401, and agent UI refresh is delayed. Comment 2165 confirms the subsequent work and missing historical names; no specific four scenario names are recoverable from these comments.

On 8 November 2026, the four existing authentication scenarios passed in Brave against the real-entry harness and a freshly initialized local database. A sanitized readback reported `users=1, records=6`; the socket test received nine frames, then observed closure and no additional frames for 400 ms after sign-out. An unauthenticated stolen seat reached the real live server and was rejected at `LiveRuntime.check`; this is not a TLS-failure surrogate. Approval and revocation refresh now retry the lobby briefly to allow the PostgreSQL authority poll to catch up; they do not assert instantaneous revocation. The existing simulated-backend browser suite also passed 4/4. Failure/recovery timing and concurrent revocation remain a separate dependent task.

For a follow-on observation run, `e2e/auth.spec.js` contains the synthetic signup and email verification flow, cookie and ticket assertions, and Playwright `websocket` frame/close listeners. The harness emits only synthetic mail to `/test/mail`, exposes aggregate counts at `/test/storage`, and launches independent control/live processes. Keep the schema and port isolation, and do not retain verification links, cookies or bearer tokens in logs. Use the direct live port 8792 only inside the fixture when proving that a cookie-free stolen seat reaches the server; HTTPS and WSS browser traffic use port 8790.

## Dependency audit checkpoint (8 November 2026)

A fresh `npm audit` after the lockfile-only transitive updates reports four vulnerable package entries: `better-auth` 1.6.33 (critical), `@convex-dev/better-auth` 0.12.5 (high, through Better Auth), and its installed Drizzle and Kysely adapter packages (low). The lockfile updates `body-parser` to 2.4.0, `fast-uri` to 3.1.9 and `qs` to 6.17.1, removing the previous advisories for those packages.

Those findings describe the earlier 1.6.33 checkpoint, not the current lockfile. The current candidate pins Better Auth 1.7.18 and `@convex-dev/better-auth` 0.13.0, whose declared Better Auth peer range includes 1.7.18. Fresh full and production `npm audit` snapshots reported zero entries on 8 November 2026; this is not a guarantee against future advisories. Re-run the audit after dependency or exposure changes. The earlier device-authorization, OAuth-proxy and magic-link advisories concerned optional plugins absent from both `online/postgres-auth.js` and `convex/auth.js`. Google social login can be configured, so this is not a claim that every OAuth path is safe. The earlier Kysely database-backed rate-limiter advisory applied to the old dependency; the current audit no longer flags it. The PostgreSQL Node control path applies an additional PostgreSQL CAS limit before routing requests to Better Auth, and strips client-supplied Vercel and Better Auth IP headers in favor of the socket peer. `test/postgres-auth-concurrency.integration.test.js` starts two actual control processes with a common store, concurrently sends 20 synthetic sign-in requests with different forged IP headers in one fixed minute, and checks five passed the outer limit, fifteen returned 429, and the shared counter is five. In local runs some of the five returned 400 rather than 401; this test does not establish the cause. This proves only the tested PostgreSQL entry point, route, concurrency and fixed window, not all routes, database outage behavior, other deployments or a rolling-window/per-account limit. Fixed windows can admit a burst on both sides of their boundary. A reverse proxy will appear as the socket peer unless a separately designed trusted ingress is added. Never expose a direct Better Auth handler that bypasses the outer boundary. Requalify the audit and tests after changing dependencies, routes, ingress, or topology. The updated Convex integration still requires separate testing against generated Convex code; the local PostgreSQL checks do not establish it. Do not treat this checkpoint as production approval.
