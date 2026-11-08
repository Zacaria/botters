# Isolated interprocess journey fixture

Run from the repository root using Node 22+, dependencies from `npm ci`, and a **new disposable loopback-only PostgreSQL cluster** as in `docs/postgres-local-verification.md`. Pick an unused port distinct from all other workers. Set `BOTTERS_TEST_POSTGRES_URL` to that cluster's empty synthetic database, then run:

```sh
node --test test/botters-real-journey.integration.test.js
```

The test refuses non-loopback database URLs and URLs with query parameters. It creates a uniquely named schema, runs Better Auth migrations and store initialization, and drops only that schema after the processes stop. An abrupt kill can leave synthetic schemas. Stop the isolated cluster after use. Do not use a shared database, personal data or external email. Passwords and email addresses are synthetic; captured verification messages travel over local child-process IPC.

The fixture launches independent Node processes for HTTP control and Colyseus, plus a third process that deletes one auth session. It exercises actual Better Auth, PostgreSQL, the control handler, PostgreSQL live authority, a WebSocket frame and live game admission. By default, HTTP and live use fixture wiring. To exercise both actual entry points, provide the local synthetic `build-id.json` described in `docs/postgres-local-verification.md` and run `BOTTERS_JOURNEY_REAL_LIVE=1 BOTTERS_JOURNEY_REAL_HTTP=1 node --test test/botters-real-journey.integration.test.js`. In this test only, a preload captures synthetic email locally and blocks other outbound fetches; no message is sent. These modes do not prove browser behavior.

A loopback TCP proxy cuts connections only between the live fixture and the database; this is a simulated network failure against real processes, not a database shutdown. The test asserts a bounded 503 after the existing authority lease expires, then recovery. On initial candidate 6aa3b5ed582357a7dee2d1fddf8a96dc6d74e84e, the live fixture instead exits with code 1; the test intentionally fails at that point. Consequently the 503 and recovery assertions are not executed on that candidate. The 48-request smoke load is not a capacity limit. Revocation timing includes third-process startup and describes one local observation, not a propagation guarantee.

The single-use ticket race, separate process restart, absent/invalid/revoked sessions, cross-account cookie refusal, real WebSocket closure, and password reset with old-session revocation are exercised. The four historical cases referred to in comment 2139 are not specified in the available reference: this suite does not claim to reproduce them. Deadline assertions here are test-harness ceilings, not an agreed production SLO. The actual-entry mode uses synthetic local mail capture; it does not verify real email delivery or browser behavior.
