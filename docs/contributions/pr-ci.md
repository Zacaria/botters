# PR CI preparation

## Acceptance and decisions (before workflow implementation)

Base: `8871d4842eaf900362052ea1ed3879027a1fa5aa`, branch
`contrib/hermes-pr-ci`. This is shared CI preparation, not another gameplay
contribution. Preserve the installer, gameplay, account/backend code and existing
feature PRs. No deployment, merge, protection/ruleset change or provider mutation
is part of this candidate.

Add one GitHub Actions workflow for PRs targeting `pvp-online`. Its stable job
name is `Botters local checks`, job ID `local-checks`, workflow name `PR CI`.
Use only a standard `ubuntu-24.04` GitHub-hosted runner, Node 24 and the checked-in
npm lockfile. Explicit `contents: read`, no persisted checkout credentials,
secrets, paid/self-hosted runners, deployment steps, `pull_request_target`, status
writes or custom artifact retention. Check out the PR's exact head SHA (not a
moving branch or only GitHub's synthetic merge commit). Any failed command must
fail the job; no optional/continue-on-error checks.

Before adding the workflow, exercise existing commands and a discriminating
local workflow-contract check. Validate both PR-head selection and restrictions
on events, permissions, runner and commands. Then run those actual commands
against this checkout, including genuine browser binaries and loopback services.
An independent bounded config/code review precedes publication. A local PASS
is not a GitHub run, required-check activation, product acceptance or release.

## Existing commands and honest coverage ceiling

Install dependencies with `npm ci --ignore-scripts --no-audit --no-fund`.
No dependency or lockfile changes are necessary.

| Command | Actual scope / preparation |
| --- | --- |
| `npm run check` | Repository JS/inline browser syntax and JSON checks; not a separate linter/type checker/formatter. |
| `npm run build` | Copies five public assets and uses installed esbuild to bundle the live browser client; no deployment. |
| `npm test` | Existing Node tests, including a real offline browser match, local HTTP/MCP/auth/Colyseus fixtures and engine tests. Requires Chromium via `BOTTERS_BROWSER`. |
| `npm run test:browser` | Local Colyseus browser suite, public pages and installer guide. Builds once and starts a fresh ephemeral loopback backend per test; no shared lobby budget or remote service. |
| `npm run test:auth:browser` | Existing two-origin Better Auth/Colyseus browser fixture on 8789/8790; captured mail and ephemeral memory storage, not real accounts/email. |
| `npm run test:auth:convex` | Existing Vitest/convex-test component integration; a fresh checkout lacks ignored `convex/_generated/api.js`. Excluded from this minimal job, not reported as PASS. |
| `npm run test:online` | External-target verification command; excluded. No production target or credential is supplied. |

Fresh-base observations: `npm run check`, `npm run build` and `npm test`
succeeded. `npm run test:auth:convex` failed: two suites could not import
`convex/_generated/api.js`, and the auth test could not find `_generated`.
The tutorial contribution's preparation note describes a pure installed-generator
workaround. This job deliberately does not copy that helper or synthesize API
responses: the smaller meaningful local/browser job requires no Convex generated
module. It does not certify Convex deployment, durable backend behavior, remote
account delivery, provider capacity or the excluded account/cost candidate.

## Reproduction

Install Chromium from the lockfile's Playwright package:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install playwright install --with-deps chromium
export BOTTERS_BROWSER="$(node --input-type=module -e 'import { chromium } from "@playwright/test"; console.log(chromium.executablePath())')"
npm run check
npm run build
npm test
npm run test:browser
npm run test:auth:browser
```

`--with-deps` installs system libraries on the disposable standard runner. Local
verification uses already installed libraries (no host package mutation) and a
worktree-owned browser cache. The explicit browser path avoids the project's
local default `/usr/bin/brave-browser`, absent on a fresh hosted runner. Do not
set `BOTTERS_SERVER`, `BOTTERS_DEV_CONVEX`, `BOTTERS_LIVE_SERVER` or hosted backend
variables. CI runs commands sequentially on an isolated runner. On the shared
builder host, serialize commands binding fixed fixture ports with the lock in
`RUNTIME-ISOLATION-v1.md`; check availability and never kill a foreign listener.

## Publication and activation gates

Before a push or draft PR, the orchestrator must freshly verify the exact
source-only destination `Zacaria/botters` (repository ID `1421211654`),
`refs/heads/contrib/hermes-pr-ci`, base `pvp-online`, including the absence of
provider Git linkage/webhook/deployment workflows. A historical receipt alone is
not a new verification. The new workflow must itself contain tests only.

After publication, read back the draft PR base/head/body and exact SHA, then
observe the actual Actions run and check run. Record the workflow/run/job URLs,
run head SHA, check name, conclusion and GitHub App ID from the real API; do not
invent a successful run or assume the App ID from convention. Report failures
as failures. The activation packet must bind these observations to the signed
candidate commit and tree.

Proposed owner action, not performed here: review and authorize merging this
workflow onto `pvp-online`, then separately authorize a required status check
bound to the observed `Botters local checks` context and GitHub Actions App ID
on that branch. Verify the resulting rule and rerun/update each feature PR so
its exact advancing head has the required successful check. Do not treat this
CI preparation PR as integration, activate settings automatically, or relax the
native exact-head gate.

## Auth CI repair acceptance (task t_45729372, before repair)

Preserve failed run `39111645398` on signed candidate
`439f6f6cbc252ae631b40e29fede557a71e482e1`. Its auth suite failed at
`e2e/auth.spec.js:49`: approval reported success, but `#agentState` remained
`none connected` for the default 5000 ms assertion. The original local suite
passes; that does not disprove the hosted failure.

Inspect the actual website approval, live authority subscription and lobby
response separately. In particular, the approval handler currently does not
refresh the lobby, whose idle polling interval is also 5000 ms. This is a
hypothesis until a controlled real-browser reproduction distinguishes stale UI
from failed approval/live adoption. Do not increase timeouts, add retries, skip
assertions or replace the local Better Auth/Colyseus services with canned data.

The regression must exercise actual approval and revocation and verify the
rendered connection state without depending on the next periodic poll. Keep
all token/cookie checks and the existing full-match/browser suites intact.
Use the shared fixture lock, no remote backend or real account. Obtain a bounded
independent review of the exact signed repair candidate before normally pushing
only `contrib/hermes-pr-ci` to update draft PR #3. Success requires the exact-head
`Botters local checks` result, not merely local success. No integration, provider
mutation, protection activation or deployment is authorized.

## Auth CI repair diagnosis and executed checks

Native Hermes session `20261018_084159_5439a5`, Kanban run `912`,
`contrib-hermes`, `gpt-6.1-sol` / `openai-codex`; native tools, no method loader.
Repair starts from the original signed `439f6f6` candidate above, not a feature
branch. Provider billing counters remain unknown; this repair is outside the
four contribution scores.

The discriminating real-browser probe freezes browser timers before navigation,
not the server clock or network. Approval succeeds, `/agent/poll` says approved,
and the live `/lobby` returns the agent while the rendered UI still says none.
Advancing only the browser clock by 5000 ms renders the agent, without another
approval or heartbeat. Revocation exhibits the inverse: live delegation is gone
but the UI still shows connected until the same clock advance. Thus failed
approval, missing live adoption and delayed backend processing are not necessary
to reproduce the defect. The absent mutation-triggered refresh leaves UI entirely
on an idle timer whose 5000 ms period coincides with the assertion deadline. This
explains the hosted failure and local variability; the historical run alone
cannot establish its exact request scheduling.

The final regression, with the clock installed/frozen before navigation, failed
before the fix at `#agentState` (expected `refresh-test-agent`, received none,
5000 ms) despite preceding successful real approval/live-state assertions.
After the fix it passed, including revoke button state, the with-agent choice
and rejected revoked capability. The original full-match assertion is unchanged.
Exploratory probe setup failures (wrong config cwd and installing the clock too
late) are retained as failures, not counted as causal evidence.

Smallest shared UI repair: successful approve and revoke reuse `lobby(false)`
to fetch/render actual live state immediately. No optimistic connection claim,
backend/auth policy modification, polling interval change, retry, skip, timeout
increase or dependency change. `false` preserves the player's menu instead of
jumping to an already running match. Failed mutations retain existing handling.
Revocation feedback is assigned after rendering so it is not erased by refresh.

Executed with Node `v24.21.0`, npm `11.19.0`, lockfile-installed Playwright
Chromium revision `1228`, sanitized allowlisted environment, no hosted backend
variables, captured-mail/ephemeral Better Auth and Colyseus fixture only. The
full sequential check run held the shared native fixture lock (dwell
`0.000087` seconds, recorded separately); fixture ports were checked under lock.

- Original local auth suite before changes: 3 passed (not a hosted CI pass).
- Controlled causal probe before fix: 1 passed, confirming both stale UI paths.
- Final new regression before fix: 1 failed, matching stale `#agentState`.
- Same regression after fix: 1 passed.
- `npm run check`: exit 0, 71 JS files, inline scripts and JSON.
- `npm run build`: exit 0.
- `npm test`: exit 0, 78 passed, 0 failed/skipped.
- `npm run test:browser`: exit 0, 9 passed.
- `npm run test:auth:browser`: exit 0, 4 passed, including the unchanged full
  match and cookie/revocation boundaries. Expected stolen-seat admission errors
  remain visible in the actual log.
- `git diff --check`: exit 0.

No Convex-generated integration or remote service is certified. Workflow and
fixture scripts are unchanged, so their previously inspected effect surface is
preserved. Independent exact-candidate review, signature/tree, remote readback
and actual GitHub CI are recorded in the task's durable evidence/handoff, not
implied by these local results. Task-local scripts and raw logs are archived
outside the cleanable checkout through the native task attachment mechanism.

## Executed local verification (original preparation)

Builder: native Hermes profile `contrib-hermes`, session
`20261018_080921_4609c6`, Kanban run `907`, model/provider
`gpt-6.1-sol` / `openai-codex`. No CE, Superpowers or pstack loader was used.
Node `v24.21.0`, npm `11.19.0`, lockfile dependencies installed with scripts
ignored. No product/dependency files change.

Before implementation the task-local workflow-contract test failed because the
workflow did not exist. Its initial invocation with system Python also exposed
missing PyYAML; the existing Hermes Python environment supplied the parser
without installing any dependency or modifying Hermes. After implementation all
five checks passed, including mutations rejecting write permissions, a moving
head, a masked failure and a remote command. This is a task-local config check,
not a new product test suite or a substitute for GitHub workflow validation.

Parsed workflow commands were run sequentially in a sanitized environment with
no inherited Botters/Convex/provider target. A worktree-owned Playwright Chromium
cache and the workflow's actual `GITHUB_ENV` browser-selection command were
used. The shared fixture lock covered the sequence; lock dwell was not separately
measured. No host system libraries were installed; the hosted runner's
`--with-deps` step remains to be observed on GitHub.

- `npm run check`: exit 0, 71 JS files plus inline scripts and JSON.
- `npm run build`: exit 0, five public assets plus existing live-client bundle.
- `npm test`: exit 0, 78 passed, 0 failed/cancelled/skipped.
- `npm run test:browser`: exit 0, 9 passed (real local Colyseus browser suite).
- `npm run test:auth:browser`: exit 0, 3 passed (real two-origin local fixture).
  The rejected expired/stolen live connection emits the expected sign-in error;
  it is not an external account login.
- `npm run test:auth:convex` on fresh base: exit 1, three failed files (missing
  generated module/root); excluded, not fixed or relabelled as success.
- `git diff --check`: exit 0.

The workflow uses full action commit pins resolved via GitHub's read-only API:
`actions/checkout` v4 at `11d5960a326750d5838078e36cf38b85af677262` and
`actions/setup-node` v4 at `49933ea5288caeca8642d1e84afbd3f7d6820020`.

### Isolated official gh

The system gh `2.46.0` rejects `gh api ... --paginate --slurp` (exit 1).
The official release `v2.102.0` Linux amd64 archive was downloaded to the owned,
ignored `.cache/pr-ci/tools/` directory and checked against its published
`gh_2.102.0_checksums.txt` and the release API digest. Archive SHA-256:
`bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386`.
No system executable, PATH/profile configuration or Hermes code was replaced.

Use this worktree-relative executable:
`.cache/pr-ci/tools/gh_2.102.0_linux_amd64/bin/gh`.
It used the existing default supported gh login resolution: no new selector was
necessary, and no credential file/token was read, printed or copied. Read-only
`api user` verified login `Zacaria`, ID `5860751`. The actual
`api repos/Zacaria/botters/rules/branches/pvp-online --paginate --slurp` returned
`[[]]`, exit 0. The system CLI remained `2.46.0` afterward.

Ignored evidence is under `.cache/pr-ci/evidence/` (baseline failures, parsed
workflow command results and actual test logs). Preserve it in the task handoff.
Publication, remote CI observations and the independent review verdict are
recorded separately against the exact signed candidate; they are not implied by
these local results.
