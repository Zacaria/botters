# Account match execution budget

## Baseline and scope

The owning activation task measured reviewed `5f34d62` from 2026-10-16
14:03:18.461 through 14:11:30.396 UTC. Its sanitized completion stream records
67 completions: 8 scheduled `store:expire`, 4 cached component lookups, and
55 uncached non-housekeeping executions. Adapter counters alone report 40
and are not the acceptance metric.

The 55 executions comprise 33 `store:authorize`, 9 `store:get`, 4
`store:commit`, 1 `liveAuth:exchange`, 2 auth HTTP actions, 4 component
`adapter:findMany`, and 2 component `adapter:updateMany`. The last six are
rate-limit accounting on the two identical server-owned session checks during
one human reload, not session validation. The cached `findOne` lookups are the
actual session/user validation.

## Small repair

After validating the existing private proxy secret, route the exact GET
`/api/auth/get-session` to Better Auth's native server `api.getSession` with
`disableCookieCache` and `disableRefresh` fixed to true. Keep all public auth
routes on the existing HTTP handler and durable abuse controls. The browser
proxy does not expose get-session. Do not change the 90-second authority
refresh, subscriptions, cookie proof, ticket exchange, session expiry, logout,
reset revocation, or agent delegation checks.

This removes the six redundant limiter executions from the measured workload,
for a replay estimate of 49 uncached non-housekeeping executions before any
other changes. This is an estimate until a real backend completion stream is
collected; it is not a hosted result. No production deployment or measurement
is authorized by this task.

## Verification

Add a real-component regression showing the private session check performs no
rate-limit component operations, still validates the stored session/user, and
cannot be reached without the proxy secret. Verify public sign-in remains
rate-limited. Re-run repository checks and exercise a full eight-minute match
with two stdio MCP clients, human reload, and durable reports on an isolated
loopback backend. Keep completion-stream accounting separate from adapter
counters and distinguish local proof from hosted acceptance.
