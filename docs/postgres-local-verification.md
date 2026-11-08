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

A fresh authority result that confirms a missing or revoked capability is an authentication refusal (401), not a backend outage. A failed or stale authority read remains unavailable (503). Revocation propagates on the polling interval and is not instant; the lease must never outlive a successful database read. These semantics alone do not wire the production servers or prove the browser journey.

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
