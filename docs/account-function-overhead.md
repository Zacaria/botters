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

## Actual isolated-backend results

The matching warm-rematch run on 2026-10-16, 14:56:27.507–15:04:38.310 UTC,
completed tick 9600 after 490.803 wall-clock seconds (eight minutes plus the
planning countdown). Two actual stdio MCP clients stayed active; one human
reloaded and resumed the same match, and both histories/reports persisted.

Its real completion stream contains 55 completions: 8 scheduled expiry jobs,
3 cached component lookups, and **44 actual uncached non-housekeeping
executions**, including one uncached Better Auth `findOne`. Adapter-only
counters report 34, which is not the acceptance total. The 44 are 27
`store:authorize`, 9 `store:get`, 4 `store:commit`, 2 auth HTTP actions,
1 exchange and 1 component query. No rate-limit component operations occur
inside this window. Evidence: `evidence/account-overhead/local-rematch.json`
and its sibling `.jsonl` completion stream.

Do not attribute the entire hosted-55/local-44 difference to the code change:
the local run has six fewer authorization executions and one additional
uncached component lookup. The focused regression establishes removal of the
redundant limiter operations; it is not a same-host production counterfactual.
A new hosted result remains unmeasured and requires existing release authority.

A separate cold first-match run at 14:41:08.846–14:49:20.585 UTC also completed
tick 9600 with reload and both durable histories, but measured **53**, above
the target. It includes post-approval MCP confirmation/startup work not present
in the original warm-rematch baseline. Keep this miss visible: this candidate
meets the measured warm-rematch workload, not a universal 50-execution ceiling
for cold startup. Its full accounting is retained in
`evidence/account-overhead/local-cold-match.json` and sibling `.jsonl`.

The isolated deployment uses the real disk-backed Convex backend and real
Better Auth component. A disposable tooling overlay captures email locally;
self-signed loopback HTTPS transports replace the external hosts. It is not a
production mail, public TLS or deployed cross-host acceptance test.

## Cold-start approval repair

The first post-approval MCP confirmation currently performs two separate
`store:get` queries (grant and owner) and a read-only `store:commit` CAS per
client. These six executions can be two: use the existing `store:get`
`followToken` facility to read the grant, pending request and owner in one
consistent database snapshot. Approval polling changes no state, so it needs
no commit. Do not fetch the owner's match in this capability-only snapshot.

Keep token-format checks, pending-request expiry, grant expiry, owner existence
and agent-version revocation checks. Every poll obtains a fresh snapshot;
there is no process-wide approval cache. All mutating game operations retain
CAS. Human authentication, live cookies, ticket exchange and the 90-second
live-authority refresh are unchanged. The four-call reduction gives an
estimate of 49 if other execution counts remain equal; the actual cold result
below is 50. No hosted result is claimed.

### Actual repair results

Signed source `be33d84df11b4d9c2292018f0e614fbe585e1c93` was exercised with
the same isolated tooling and real wall clock. Both runs used two actual stdio
MCP clients, a human reload, tick 9600 and both durable reports/histories.

| Window (UTC, 2026-10-16) | All completions | Cached | Scheduled expiry | Uncached non-housekeeping |
| --- | ---: | ---: | ---: | ---: |
| Cold 15:16:26.745–15:24:37.721 | 62 | 4 | 8 | **50** |
| Warm 15:25:50.456–15:34:01.318 | 60 | 4 | 8 | **48** |

The cold window includes post-approval MCP confirmation during startup. It
lasted 490.976 seconds. Its 50 are 30 `store:authorize`, 13 `store:get`, 4
`store:commit`, 2 auth HTTP actions and 1 ticket exchange. The four cached
component lookups are Better Auth `adapter:findOne`; no uncached component
operation or failed completion occurred. Compared with the retained cold-53
stream, two reads and two commits disappeared, while one additional authority
execution occurred. The focused regression proves the four-call reduction;
do not attribute the entire between-run change to it.

The warm window lasted 490.862 seconds. Its 48 are 32 `store:authorize`, 9
`store:get`, 4 `store:commit`, 2 auth HTTP actions and 1 ticket exchange. It
also has four cached Better Auth lookups and no failed or uncached component
execution. It meets the target but does not reproduce the producer's exact
44: authority executions are 32 rather than 27, with one fewer uncached
component lookup. Its non-authority app-function counts are unchanged. The
90-second refresh and subscription implementation were not modified.

Evidence: `evidence/account-overhead/local-cold-start-repair.json` and
`local-warm-start-repair.json`, each with its sanitized `.jsonl` stream.
Adapter-only totals are 39 and 38, respectively, not acceptance totals. Cold
passes exactly at the ceiling; these are measured windows, not a universal
maximum or hosted-production claim. No production or provider operation ran.

The new actual-component regression checks one fresh read-only query per poll,
no match read, pending and grant expiry, owner expiry/version revocation,
malformed bearer rejection, repeated scoped reads and storage-failure denial.
Final repair gates pass 69 Node, 5 component, 3 account-browser and 7 ordinary
browser tests, syntax/JSON checks, production build and runtime dependency
audit. No separate lint/type/format command is configured. Deleted code is the
old transactional poll branch and unused follow-token match read; no whole
files or runtime dependencies were deleted or added.

Integration remains a separate step after independent review. Reconcile the
installer head `8871d4842eaf900362052ea1ed3879027a1fa5aa` before assembling a
release candidate; this offline task does not authorize deployment.

## Producer source and security checks

The new actual-component regression fails on the original handler because
private identity lookup writes a rate-limit bucket. It passes on the native
server-API candidate: wrong/missing proxy secrets reach no component functions,
session/user reads remain, public sign-in still reaches HTTP 429, and password
reset/logout revoke stored sessions. The bounded independent precommit source
review returned PASS for the handler and test hashes.

Final repository gates: 69 Node tests, 4 actual-component tests, 3 account
browser tests and 7 ordinary browser tests pass; syntax checks, build and
runtime dependency audit pass. No files or dependencies were deleted or added
to runtime. No production deployment or Git remote push was performed; the
signed source and evidence bundle are preserved for independent review.
