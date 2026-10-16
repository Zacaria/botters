# Account-cost release preflight — t_bd78af25

Status: offline preparation PASS; production rollout waiting for exact-effects authorization. No production release is claimed.

## Approved identity and remote state

Reviewer t_7c7b7a64 approved signed candidate `6c10644406707b1e2a0f33d3d0ea30fbdc06e205`, tree `a2916e07823ea090894a3a89afab1a8d9caa6d23`. The durable candidate bundle verifies and matches SHA-256 `bd58b748b0c9a1d7603937a6eec921845944d03c12f627a94a3c6a65dcc020aa`. Fresh archive and binary first-parent diff match the reviewer fingerprints `839a8a54249b32f78cfb52d0e6481c53e9f96ba251f2d9b99c4e14353c89d5bb` and `b04408a0526bc67eba78ab6c794418b851e6fb902346bf723bdd2183117f5fd5`.

Good SSH signing fingerprint: `SHA256:aSUe6Xvs+Cb6yJp/s++7LiozJ+LfaYmWxhe3W34YGGQ`. The exact clean candidate was rechecked before evidence preservation. The 16-path first-parent diff equals the review allowlist. The four runtime repair paths match reviewed account input `63639f4df10363c6d02d500c313453de61fe2719`; installer implementation, package manifests and guide match released installer `8871d4842eaf900362052ea1ed3879027a1fa5aa`.

At `2026-10-16T16:17:13.844642+00:00`, remote HEAD remains `pvp-online` at `8871d4842eaf900362052ea1ed3879027a1fa5aa`; fast-forward to the approved integration is possible. This is not permission to push. This receipt is an evidence-only local commit, not the candidate to deploy.

## Fresh executed checks

Inside the task's isolated source worktree:

    npm ci
    npm test
    npm run check
    BOTTERS_LIVE_URL=https://play.botters.havesomecode.io BOTTERS_REQUIRE_ACCOUNT=1 npm run build
    npm audit --omit=dev
    git diff --check
    git status --short

All pass: 78/78 Node tests, no skips, duration 41107.451505 ms; syntax/inline/JSON check covers 72 JS files; clean candidate build contains exactly seven intended public files; zero audit vulnerabilities. npm warns that esbuild and msgpackr-extract install scripts have not been approved. No install-script approval settings were changed.

The task-local `verify_preflight.py` independently checks candidate/tree/signature/archive/diff identity, path allowlist, fast-forward ancestry, source slice parity, all seven public assets and route error behavior. Its actual result is retained in the adjacent JSON receipt. Initial bundle fetch incorrectly requested a branch ref; the bundle advertises `HEAD`, and fetching that advertised ref succeeded without modifying a remote.

## Public baseline and smallest release

Ordinary strict-TLS unauthenticated reads matched all seven candidate-build assets on both `https://botters.havesomecode.io` and `https://botters.vercel.app`: home, guide, sim.js, privacy, terms, live-client.js and live-config.json. Therefore no Vercel deployment or guide republication is needed for this repair. Both aliases return 401 for `/session`, 200 for anonymous `/account`, and 404 for an unknown static route. The live service also rejects anonymous `/session` with 401.

`https://play.botters.havesomecode.io/health` remains healthy on `5f34d62cd2dbbe55d98da5f83b7194b962c12230`, Colyseus, zero active matches. Its counters were query60/mutation9/subscription10/updates18; these are process counters, not a fresh match measurement.

Remaining mutation scope is:

1. Fast-forward existing GitHub `Zacaria/botters` branch `pvp-online` from `8871d4842eaf900362052ea1ed3879027a1fa5aa` to approved `6c10644406707b1e2a0f33d3d0ea30fbdc06e205`.
2. Deploy reviewed code to existing Convex `fastidious-kookabura-364`, keeping schema, stored data, provider settings and resource plans unchanged.
3. Replace only the existing Botters game service on the existing Lightsail instance, preserving Caddy, sibling services, secrets and all data. Recheck zero live matches and the complete legacy aggregate immediately before replacement.
4. If authorized, verify authenticated admission, pairing/revocation, reload and one full-duration match using only existing owner-controlled acceptance accounts and scripted MCP clients; keep actual hosted completion accounting separate from adapter counters. No new customer account, email, paid inference or end-user record operation is requested.

There is no authority for DNS/firewall changes, new resources, subscriptions, purchases, provider configuration, data reset/migration, outreach or unrelated history changes.

## Authority reconciliation and exact remaining decision

The release card explicitly grants no new push/deployment/provider/hosted-account-write authority, and the parent approval is offline only. The direct owner history in default session `20261013_203818_a1e890` and its referenced companion `20261016_074316_ceac64` was inspected, including the original production/PvP request, existing $12 Lightsail choice, account feature request and later installer request. These establish existing infrastructure/product intent, not explicit current authorization for this exact account-cost rollout. Later assistant promises to deploy were not treated as owner approval.

Decision requested: authorize the four bounded effects above for approved candidate `6c10644406707b1e2a0f33d3d0ea30fbdc06e205`, on existing resources only with no additional spending; leave Vercel and both public guides unchanged. If hosted acceptance writes are not authorized, keep that verification boundary waiting rather than claiming a complete production result.

No Git push, deployment, restart, provider operation, hosted account/pairing/match write or email was performed. No customer data or source was deleted. No full auth-component/browser/native-client suite was repeated; the exact-candidate independent reviewer evidence remains valid. No fresh eight-minute or hosted measurement was run. Cold50/warm48 are inherited isolated windows, not a universal ceiling.

The board has no independently ready/todo Botters work to hand off; the other open Botters card is an already-blocked tailnet administration card. No speculative follow-up or duplicate installer release was created. Retain this task's isolated worktree as unfinished release input; do not retire it while the authorization decision is pending.
