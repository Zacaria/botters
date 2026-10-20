# Botters swarm successor: production reconciliation, partial acceptance

Task `t_abfb2be1`; verification operator `release`; 2026-10-20 UTC.

## Result and exact next action

The approved successor already exists at production. This run performed no production deployment, PR merge, alias assignment, provider change, account operation, email or player-data mutation. Do not redeploy it merely to finish this card.

Remaining acceptance: supply a saved, authorized Botters production test login through the secure browser vault, then resume this same release lane to select modes and complete a real public house match. The fresh browser was signed out; `browser_vault(action=list)` returned no items. No signup, password entry, mailbox access, owner-session reuse, synthetic identity or authentication bypass was attempted. Local fixture gameplay is not production acceptance. The task remains blocked rather than falsely complete.

## Approved source and independently verified deployment

- Independent reviewer `t_c274105c` is DONE/PASS for signed `581ce19d05e3d1fde122049cdfe9f74a40ed34f7`, tree `04d55305ba1beadeb6233683e8b3afd481aa44ef`. `REVIEW.md` and original `review-evidence.zip` are retained beside this report; archive SHA-256 `9bc9a14e66d0db8d04f185a45200a9fc5b00f203e1ff0a841a5503f2e0b828b6`, 1,179,912 bytes.
- Current protected merge `d6630fca9b252948088ea06f9c3b6329ff72ded8` has exactly that tree. GitHub reports its signature valid/verified at `2026-10-20T08:06:31Z`. Candidate SSH signature is locally valid. Local GPG cannot independently validate GitHub's merge signature because its public key is absent; provider verification is explicitly the source for the merge signature result.
- Required exact-head CI `39389931993` is SUCCESS for `581ce19`, completed `2026-10-20T08:05:04Z`: https://github.com/Zacaria/botters/actions/runs/39389931993 . Strict required check remains `Botters local checks`. `origin/pvp-online` and `origin/feat/swarm-depth` readbacks match the merge and approved head.
- Both https://botters.havesomecode.io and https://botters.vercel.app resolve through Vercel deployment inspection to READY production `dpl_7v2xmoicQzJMPc2RFRVswAbtuUk7`, https://botters-7se7todm8-zacaria-chtatars-projects.vercel.app. All 193 uploaded source files present in the remote deployment inventory SHA-1 match exact candidate file bytes, including API/server/build/config/lockfile paths. One tracked source file is not uploaded; the complete source-parity inventory is retained, not a claim that every tracked file was uploaded.
- All ten production-build public assets match SHA-256 bytes on both public aliases (20 comparisons). This includes media, `sim.js`, bundled `live-client.js`, and config exactly `{"url":"https://play.botters.havesomecode.io","accountRequired":true}`. Exactly 15 source files inside the running game container match the reviewed candidate: live entry point, online modules, simulation and package/lock files.
- At `2026-10-20T08:27:54.334665+00:00` verification start, the subsequent public `/health` readback was `ok`, build `d6630fc`, zero active matches and zero Convex query/mutation/subscription/update counters. Container `aca085f86bc4cef4e90a1d7e9f26c8cdbd64bf7c952a9a38789b112664addc5b` uses image `sha256:fa6ee098eb263187eb5ce18a891153093f52c7eb5fd6d3170e61e5dd6cdca3a1`, started `2026-10-20T08:10:06.57372462Z`, restart count zero.

## Public journey, errors and sibling protection

Fresh isolated Brave contexts on both aliases pass homepage, guide, privacy and terms navigation with zero uncaught page errors. Canonical hostname displays Google/email sign-in and hides Play; the Vercel alias intentionally hides its credential form and displays the correct canonical login link. No authenticated mode controls are created before lobby initialization. Public `account` metadata returns the expected signed-out null user, not player data.

Negative/error behavior: unknown route 404; website retired game `/state` route 410 with move-to-live message; live invalid-session state/play requests 401; anonymous `/mcp` 401 with correct OAuth resource-metadata challenge. The probe initially expected 401 for `/account` and website `/state`, and omitted the OAuth issuer's trailing slash. Source inspection established the intended 200/null-user metadata, retired-route 410 and exact trailing-slash issuer; only probe expectations were corrected. Browser probe initially expected already-created mode controls and a credential form on the secondary alias; source inspection confirmed both are intentionally gated. No application repair was made.

Sibling OAuth MCP container `079c8e2f6b1076b8ed61871a9032e661b2f899e07a869c949d636e1a24121b36` remains image `sha256:d36537e0b3189f184aaee4aea3ea6e189e9585e3896f10ba2b65df24e7e18897`, started `2026-10-20T05:25:28.722033924Z`, zero restarts. Caddy container `6bd062527f359389806bd316e217c6283c03965e64c18c859806ce4ca35fa0b1` started `2026-10-16T08:28:28.806030957Z`, zero restarts. Both predate this game replacement. Public OAuth authorization/protected-resource metadata remain correct. Authenticated MCP invocation was not performed. Loopback `/health` requests to the MCP origin were rejected by its host/origin policy and were not treated as outages or authorization to change it.

## Existing external rollout chronology, not this operator's actions

Read-only history source: default profile session `20261019_214627_0224d2`, messages 1669178–1669203. The external operator merged PR #18 at `08:06:31Z`, observed `active=0`, saved `compose.pre-d6630fc.yaml`, selected game image/source `d6630fc`, and invoked `docker compose up -d --no-deps game`. Initial image restart failed with EACCES reading `/app/scripts/live-server.js`; it corrected archive file modes with `chmod -R a+rX rel-d6630fc`, rebuilt the same source and restarted only game. Current image/health above confirm recovery; there were no active rooms at the recorded switch.

It then staged with:

`npx --yes vercel@64.7.0 deploy --prod --skip-domain --yes --scope zacaria-chtatars-projects --build-env BOTTERS_LIVE_URL=https://play.botters.havesomecode.io --build-env BOTTERS_REQUIRE_ACCOUNT=1`

It inspected staged config and promoted:

`npx --yes vercel@64.7.0 promote https://botters-7se7todm8-zacaria-chtatars-projects.vercel.app --scope zacaria-chtatars-projects --yes`

The history promotion result names `dpl_7v2xmoicQzJMPc2RFRVswAbtuUk7`; current provider/public readbacks independently verify it. Rollout predates the combined review card's final PASS (`2026-10-20T08:19:23Z` from board completion timestamp); later approval cannot retroactively satisfy the pre-release sequencing gate. This run neither performed nor retroactively authorized that earlier release. Current reviewed/deployed byte identity is proven, and no duplicate release is warranted.

## Commands and evidence produced in this run

`git fetch origin pvp-online feat/swarm-depth`; `git verify-commit 581ce19`; `git diff --quiet d6630fc 581ce19`; `git ls-remote origin refs/heads/pvp-online refs/heads/feat/swarm-depth`; GitHub PR/check/branch-protection/signature API reads; read-only Vercel deployment/source-file APIs and `npx --yes vercel@64.7.0 inspect ... --json`; SSH Docker inspect/source SHA-256 readbacks; public HTTP requests; secure vault inventory; fresh Brave navigation.

Replay checkout: `git worktree add --detach /srv/hermes-ssd/workspaces/botters/swarm-release-verification-t_abfb2be1 d6630fca9b252948088ea06f9c3b6329ff72ded8`; then `npm ci --no-audit --no-fund` and `BOTTERS_LIVE_URL=https://play.botters.havesomecode.io BOTTERS_REQUIRE_ACCOUNT=1 npm run build`. Build PASS; worktree clean. Install warns about existing unapproved esbuild/msgpackr lifecycle scripts, and Vercel's historical build warns about broad Node engine range; no package or runtime policy was changed. Verification commands: `python verify_production.py` and `node verify_public_browser.mjs`; successful versions retained beside the receipts. They contain no credentials, but paths are run-local and require rebinding for replay.

Evidence files: `verification.json`, `vercel-source-parity.json`, `public-assets.json`, `routes-errors.json`, `mcp-public-metadata.json`, `runtime-source-parity.json`, `container-receipt.txt`, `public-browser.json`, reviewer report/archive and the two verification scripts. Not run: authenticated public mode selection/house match/morph/results, real Claude/ChatGPT play, unrelated account-cost legacy aggregate queries, hosted Convex deployment/codegen, or local full-suite reruns (exact-tree independent PASS reused). No source/player records deleted. Temporary replay cleanup, if performed, is recorded separately after evidence remote retention.

Board readback found no eligible independent Botters engineering lane: only this running lane and the separately blocked tailnet/account-cost release cards. No duplicate review, account-creation task or speculative work was spawned.
