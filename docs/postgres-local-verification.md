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

Use an unused port and a new cluster; trust authentication is acceptable only for this temporary isolated cluster. Protect its directory and stop it promptly. Do not store credentials in this document or a repository file. Tests require `BOTTERS_TEST_POSTGRES_URL` to be an explicit loopback URL. Better Auth uses a synthetic `BETTER_AUTH_SECRET` and `SITE_URL` inside the test; email stays in memory. No Resend or external service is used.

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

The real Colyseus entry point supports `BOTTERS_LIVE_BACKEND=postgres`, with `DATABASE_URL` and a nonempty `BOTTERS_STORE_NAMESPACE` shared with the HTTP store. Set exact `PLAYER_ORIGINS`, `BOTTERS_REQUIRE_ACCOUNT=1`, and run `node scripts/live-server.js`. The deployment build supplies `build-id.json` with a `commit` field; local tests create a temporary synthetic one if absent. The process checks the existing record and Better Auth tables before listening; run the migrations separately first. It does not create or migrate tables at startup. Keep the database URL private. `node --test test/postgres-live-entry.integration.test.js` launches the actual entry point against `BOTTERS_TEST_POSTGRES_URL` and checks health and shutdown. This live entry point alone does not wire the HTTP authentication service or establish the end-to-end journey.

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

Before the idle-pool error handlers, the same TCP cut caused both actual entry processes to exit with an unhandled PostgreSQL pool error. The live journey and a separate control-process idle-socket test now cover their survival. This control test does not establish all HTTP outage or recovery semantics. The four historical failures referenced in comment 2139 remain unidentified, so they have not been replayed. The Convex integration command still needs the absent generated Convex files; no remote code generation was attempted. Browser behavior, real email delivery and production migration remain outside this verification.
