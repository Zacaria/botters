# Account-cost successor integration

## Decisions recorded before integration

Task `t_001b030b` reconciles reviewed account-cost candidate
`6c10644406707b1e2a0f33d3d0ea30fbdc06e205` (tree
`a2916e07823ea090894a3a89afab1a8d9caa6d23`) with fetched default branch
`pvp-online` at `3e0c15df37b584c2a688332a09759495c4a71bf0`.
The prior candidate's durable bundle and independent PASS are the inputs, not
an instruction to release its old SHA. The common ancestor is
`8871d4842eaf900362052ea1ed3879027a1fa5aa`.

The input deltas are disjoint: 16 account-cost/integration paths and four newer
paths (`index.html`, `e2e/auth.spec.js`, `.github/workflows/pr-ci.yml`,
`docs/contributions/pr-ci.md`). Use a two-parent merge starting from the fetched
remote head. Preserve both histories and every input blob; do not cherry-pick,
rewrite history, or introduce runtime conflict resolutions. This document is
the only successor-authored tracked addition. Delete no files or dependencies.
The original integration document remains a historical receipt for its own
candidate and verification, not a current release instruction.

Retain the installer and account authority/security behavior unchanged. Retain
both explicit lobby refreshes after approval/revocation, their real-browser
frozen-timer regression, and the exact required-check workflow. No UI copy or
API contract changes are needed. Existing regression suites plus exact input
blob/ancestry assertions cover the integration; no duplicate behavior tests
are necessary for a conflict-free merge.

## Verification and evidence boundary

Before merging, run an ignored integration assertion against the remote base
and retain its expected failure for missing account changes. After merging,
require both parents as ancestors, all 20 disjoint input paths byte-identical,
and only this additional document. Preserve the original input artifacts and
independent review byte-for-byte.

Install locked dependencies with `npm ci --ignore-scripts --no-audit --no-fund`.
Run `npm test`, `npm run test:auth:convex`, `npm run test:auth:browser`,
`npm run test:browser`, `npm run check`, `npm run build`,
`npm audit --omit=dev`, signature verification and `git diff --check`.
There is no separate configured lint, type or format command.

Generate ignored `convex/_generated/api.js` from the installed Convex SDK's
unmodified `componentApiJs()` template, locally without a deployment. Component
tests must execute the actual schema and Better Auth component, not mocked
responses. Serialize fixed-port fixtures under
`/home/hermes/.hermes/cache/scratch/botters-contribution-browser-fixtures.lock`,
check fixture-port availability, and never reuse or stop another worker's
listener. Use Brave and sanitized subprocess environments without hosted targets
or provider credentials. All account writes and captured mail are ephemeral
loopback fixtures.

Repeat the existing installer smoke through an ignored harness copy: actual
Claude/Codex CLI configuration reads in fresh HOME, packed candidate transports,
install/update/idempotence/uninstall, and tools/list against a closed loopback
endpoint. Keep registration assertions unchanged and redirect its receipt away
from tracked evidence. This does not exercise native macOS/Windows GUI clients,
the public GitHub install command, hosted pairing or a production account.

Retain command logs and exit codes, harnesses, exact input/source fingerprints,
build-file hashes, binary diff, signed source branch, complete Git bundle and
review packet. Re-read the remote at handoff and bind evidence to the successor
SHA/tree. Do not label inherited evidence as a fresh execution.

## R1: preserve auth selection during account bootstrap

Independent review of initial successor `fa53defd8eccd5cd368ceedb97bb498eacf6ffea`
reproduced an inherited onboarding race. The initial real `/account` response can
arrive after a player chooses signup and fills the form. Its unauthenticated
branch unconditionally calls `setAuthMode('signin')`, changing the submit endpoint
and clearing the password. The earlier intermittent signup failure is consistent
with this defect, but its exact timing was not captured and remains unproved.

Initialize the query-derived auth mode once before starting account bootstrap.
An unauthenticated account response must not reinitialize the interactive form:
preserve the current mode, inputs and result message. Keep reset-token handling,
canonical-origin redirection, account-required checks and session issuance intact.
No account/backend/installer/CI behavior changes are authorized by this repair.

Add a deterministic Brave regression that holds only the actual initial 200
`/account` response, selects signup and fills all fields before releasing it.
Assert the selected form and every input survive; submit to the real Better Auth
signup endpoint, read captured local verification mail and follow its real link
to the lobby. Do not add sleeps, retries or longer timeouts to hide the race.
Run the regression against the old source first and retain its expected failure.

This revision changes only `index.html`, `e2e/auth.spec.js` and this document beyond
the initial successor. The original 20-blob equality requirement above describes
the initial merge: 18 original inputs remain identical and the two UI/test inputs
have only this R1 delta. Preserve the initial source/evidence and independent R1
reproduction unchanged. Rerun the canonical checks and installer smoke, create a
new signed candidate and self-contained bundle, and request same-card review.
Cold50/warm48 remain inherited isolated results, not fresh cost measurements.
No files or dependencies are deleted.

## Release boundary

Cold 50 and warm 48 remain the prior independently reviewed isolated-backend
windows in `account-function-overhead.md`, not new successor or hosted results.
The cold window meets the limit exactly; neither is a universal execution
ceiling. This integration does not rerun full-duration cost measurement because
its backend and measurement bytes must remain identical to the reviewed input.

This task permits ordinary scoped preservation only. It does not authorize a
default-branch merge/push, required-check bypass, deployment, provider change or
hosted-account write. The existing release authorization names the old SHA.
Independent review of this exact successor must precede completion; release task
`t_bd78af25` then reconciles current successor-specific authority and remote
ancestry immediately before any release action.
