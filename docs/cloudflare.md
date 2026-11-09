# Cloudflare candidate

This replaces the Node/PostgreSQL/Colyseus online runtime. Offline Node house games, the simulation, Rust/WASM rules and MCP tool contracts remain. There is no data import and no database reset.

## Boundaries

- One Worker serves the existing static client, Better Auth, game HTTP and remote MCP. Accounts, sessions, capabilities, room/queue coordination, checkpoints, results and Elo use D1. Every access check reads primary authority; KV is not involved.
- Each match ID addresses one Durable Object. It serializes game commands, advances the existing 20 Hz simulation and sends side-filtered WebSocket frames. Durable checkpoints and input logs survive object eviction. A single D1 compare-and-swap batch protects all records touched by a game operation, including the match-end/history/Elo boundary.
- HTTP actions are authorized afresh before admission. Revocation need not cancel an action already admitted. Sockets recheck authority every 500 ms, stop frames when their short authority deadline expires, and close on failure/revocation. The target is closure within two seconds; this is not an instantaneous revocation claim.
- Verified humans retain account cookies plus a human capability bound by a single-use live ticket to an HttpOnly live cookie. Agents receive only explicitly approved versioned seven-day grants; they cannot start online matches or invoke human controls.
- Authentication uses the native Cloudflare `send_email` binding (`env.EMAIL.send`), without REST tokens, HTTP mail relay or Resend. The checked-in pilot restricts sender to `botters@mail.havesomecode.io` and recipient to the owner's designated address. Production release must explicitly align the app and binding recipient allowlists, verify the domain's message preview is disabled and suppressed-recipient dropping is off, then prove real binding access and inbox receipt. Local verification uses the actual Miniflare native email simulator and reads its private local mailbox, not a delivery claim.

- Account deletion removes the account profile, its capabilities, OAuth grants and rating rows, and anonymizes the player in retained match checkpoints. Other players' existing match summaries can retain the earlier display name until their history is replaced; contact the operator for historical-data requests. Authentication itself fails closed as soon as the user disappears, independently of cleanup.

## Implementation and verification

The initial tracer is a real local D1 transaction: stale compare-and-swap writes must fail atomically, including concurrent requests. Subsequent workerd tests cover real Better Auth signup/verification, two accounts, consent, tickets, WebSocket reconnect, MCP input, result retries, sign-out, password reset, account deletion and authority failure. Local captures do not establish hosted availability or hosted delivery.

Worker configuration, exact local commands, measured cadence/resource evidence and release limits are recorded below. Release must use a clean pinned reviewed snapshot, set explicit D1/DO bindings and secrets, apply only the new schema, verify mail configuration, then read back the hosted user journey. No new subscription is authorized.

## Local operation

1. Run `npm ci --ignore-scripts` and `npm run build:worker` with Node 22 or later.
2. Put a random secret of at least 32 characters in a private ignored `.dev.vars` file as `BETTER_AUTH_SECRET`. Do not reuse the test harness secret for a hosted application.
3. Apply `cloudflare/migrations/0001_initial.sql` only to the new local database with `npx wrangler d1 migrations apply botters --local`. It creates Better Auth's SQLite schema and game CAS records; it neither reads nor imports a previous database.
4. Start `npm run dev` at the configured `SITE_URL` (`http://localhost:8787` by default). The native local Email simulator captures mail in the local explorer; it does not deliver it. The checked-in recipient guard is intentionally owner-only.
5. Run `npm run check`, `npm test`, `npm run test:browser` and `npm run build:worker`. A local upload/package check is `npx wrangler deploy --dry-run --outdir .cache/release` and does not activate the application.

The automated Node/workerd fixtures use isolated D1/DO stores, actual Better Auth and native local `send_email`. Their mailbox reader is explicitly worker-scoped, never an aggregate peer mailbox. Browser fixtures additionally advance only the isolated match clock in D1 (10×) and age one isolated agent-presence row for the idle-agent case. There is no production clock flag or fabricated auth/game/mail API response. The cadence sample and revocation deadlines use real wall-clock time, without acceleration.

## Data and runtime ownership

- D1 reads start on primary authority. Better Auth's D1 `expiresAt` is an ISO date; SQL checks it as a date and the returned lease must be finite. Sessions are not authorized by a KV or cookie cache. Every game-record write uses an atomic D1 batch containing all compare guards, user-existence guards and writes; read-only CAS uses a single read, not guard row writes.
- Each match DO retains versioned WASM handles for speed, not access rights. Every request reads committed match versions; input/checkpoint changes invalidate stale handles. A failed or uncertain commit discards them. Checkpoints are written every 100 simulation ticks, and on creation, inputs and completion. The object alarm resumes a disconnected match at wall-clock time and stops after completion. Replayed counterfactual simulations are released after producing the report.
- Native WebSockets carry the existing side-filtered `matchFrame`; max eight sockets per match. Frames target 10 Hz while the simulation remains 20 Hz. Fresh primary checks occur every 500 ms, with a 750 ms query bound and an independent one-second authority deadline/watchdog. D1 failure or expiry closes the socket and admits no new command. A command already admitted is allowed to finish.
- `/next`, `/events` and `/agent/poll` retain bounded long polling outside the match's serial command queue. Every poll re-enters authorization. Human POSTs with an empty body remain valid; bodies and MCP JSON requests are bounded to 16 KiB.
- Public video range requests are served as byte ranges even when the assets binding returns a full response; this allows native seeking. The fallback is limited to the single shipped video.
- `/mcp` uses the SDK's Web-standard Streamable HTTP transport and official non-code-generating edge schema validator. One grant-keyed DO owns shared tool state/cursor across MCP sessions; each session remains within its grant. Completed internal requests clear their deadline timers so they do not keep an idle object alive. Eviction can require a new MCP initialize, but does not authorize a new agent or discard the saved gameplay cursor. Max eight protocol sessions per grant; idle transports expire after ten minutes.

OAuth uses public registered clients, exact HTTPS or loopback callback matching, S256 PKCE, only `botters:play`, and the exact `<SITE_URL>/mcp` resource. Browser-bound consent and game approval are both required. Codes are single-use for 60 seconds; access tokens last at most ten minutes; rotated refresh tokens retain spent-token tombstones through the grant lifetime so reuse revokes the grant. Pending consent lasts ten minutes, clients expire after 30 days, grants never outlive the approved agent's seven days. No upstream capability is returned as an OAuth token. OAuth revocation does not sign the human out; password reset and account deletion revoke the agent's underlying access too.

## Release-only work

Independent review must name the exact signed candidate before release uses a pinned clean snapshot. Release owns the real account/binding readback and must replace the all-zero D1 placeholder with the intended database ID, set the HTTPS `SITE_URL` and a fresh `BETTER_AUTH_SECRET`, bind both DO classes and the native `EMAIL` service, and align the explicit recipient allowlists. The source has no REST mail token, relay or Resend fallback. Before any real auth mail, verify that preview is disabled and suppression behavior does not silently discard an auth message for `mail.havesomecode.io`. The sender is fixed to `botters@mail.havesomecode.io`. Google remains optional and requires its existing client credentials and the new same-origin callback; local email tests do not qualify Google or a browser assistant's hosted connector.

No provider-side mutation, DNS change, hosted schema application, resource creation, real email, existing-data deletion or remote deployment is performed by the builder. D1's per-frame metadata writes and primary latency remain a hosted cost/cadence qualification item; the local sample is neither a load test nor hosted billing evidence. No R2 or KV resource is required.

Primary contracts consulted: Cloudflare D1 `D1Database`/sessions and batch API; Durable Objects WebSocket API; Email Service “Email Sending Workers API” and “Send bindings”; the installed Better Auth D1 adapter and MCP SDK's Web-standard transport/edge validator. Local versions are pinned by `package-lock.json`.
