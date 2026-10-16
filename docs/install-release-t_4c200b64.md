# Installer integration receipt — t_4c200b64

Status: integration verified; default-ref change and website publication are blocked on owner authorization. This is not a completed production release.

## Exact integration

Independent approval: t_d0bc2c37 approved signed `8871d4842eaf900362052ea1ed3879027a1fa5aa` against `8840ddb9b77557c430abea27c9a22d312646e8c5`. Its tree is `c56ffbb21c708ccec2ec9b412e0d70e2b84beda2`. All twelve approved paths were integrated without byte changes. No conflict resolution or new runtime code was needed.

An isolated linked worktree, inside this task's native scratch workspace, started at the destination baseline. Commands:

    git merge --ff-only 8871d4842eaf900362052ea1ed3879027a1fa5aa
    git verify-commit 8871d4842eaf900362052ea1ed3879027a1fa5aa
    git push origin HEAD:refs/heads/pvp-online
    git ls-remote origin refs/heads/pvp-online

Immediately before push, assertions verified clean source, exact candidate/tree, and remote baseline/candidate refs. Push succeeded without force; remote readback returned exactly `8871d4842eaf900362052ea1ed3879027a1fa5aa`. Tool timestamp after readback: `2026-10-16T15:06:16+00:00`. Signature verification reported a good SSH signature for the established owner key, fingerprint `SHA256:aSUe6Xvs+Cb6yJp/s++7LiozJ+LfaYmWxhe3W34YGGQ`.

The Vercel project read API returned `link: null` and `gitRepository: null` for Botters project `prj_AjBus0nBvZlNUIloFiOi96s0Plnl`, team `team_lpN3ikyEWpXFfrV53eNYNWQd`. No deployment was requested. No existing implementation/reviewer worktree was modified.

## Fresh checks on the approved candidate

- `npm ci`: installed 199 packages; audit reported zero vulnerabilities. Existing uncovered install-script warnings: esbuild 0.27.0/0.28.2 and msgpackr-extract 3.0.4; no permission changes.
- `npm test`: 78/78 pass, including actual paired MCP and offline Brave checks.
- `npm run check`: 71 JS files plus inline scripts/configuration passed. No separate lint/type/format configuration exists.
- `npm run build`: five intended public assets built; `git diff --check` passed.
- `npm run test:browser -- e2e/install.spec.js`: 2/2 Brave guide tests passed, including no-JavaScript setup copy.

The unchanged `scripts/verify-install.js` was loaded and executed through `node --input-type=module -e` with only its evidence output redirected outside the source tree. Packed fresh-HOME verification passed against actual Claude Code 2.1.285 and Codex 0.159.0, Node v24.21.0: both registrations readable by real CLIs, seven tools exposed by each registration and the packed MCP, byte-identical no-op rerun with no new backups, offline-only update, uninstall and repeat uninstall.

A second run changed only the harness setup argv to `npx --yes github:Zacaria/botters#pvp-online install ...`, its cache directory to `.cache/release-public-branch-npm`, its step label and output path. This public branch-qualified command passed the same checks in another fresh HOME/cache after remote integration. Exact source hashes and structured results are in `install-release-t_4c200b64.json`. Package metadata in that JSON describes the locally packed comparison artifact, not a hash of GitHub's downloaded archive.

Codex warned that fresh CODEX_HOME did not yet exist during version probing and refused helper PATH aliases under temporary storage; registration, CLI readback, tools/list, rerun and uninstall still passed. Codex's installed CLI JSON omits the approval-policy field; the verifier checked `default_tools_approval_mode="approve"` in TOML. Temporary client HOME fixtures were removed by the existing verifier. No source files were deleted.

## Public boundary and exact remaining decision

At `2026-10-16T15:06:33.848601+00:00`, ordinary unauthenticated strict-TLS GETs to both `https://botters.havesomecode.io/guide` and `https://botters.vercel.app/guide` returned 200, no redirect, SHA-256 `b779b44aa38c9cc03bd460dc6c7a816286a54fd277d851ae9b724f3428fa6145`. Both retain the prior branch-qualified command and neither advertises the new unqualified installer. Neither matches candidate guide SHA-256 `cd9482effb5c659abf0b147f309bb24678764d578db54520419b9229cc34cf31`.

Fresh `git ls-remote --symref origin HEAD refs/heads/pvp-online` still returns default `master` at `42e711776b516b35fde2301544f7ee3b398b88d7` and pvp-online at the approved installer. `gh api repos/Zacaria/botters` independently confirms public repository/default master. Master lacks the installer.

Required owner decision: authorize changing the GitHub default branch from `master` to `pvp-online`, whose installer candidate is `8871d4842eaf900362052ea1ed3879027a1fa5aa`. The task explicitly does not authorize that change or merging into master. Guide publication remains held until the literal `npx -y github:Zacaria/botters install --yes` succeeds in a fresh HOME after an authorized default-ref correction.

Not performed: default-branch mutation, master merge, literal default-ref acceptance (known unavailable source), website deployment/promotion, full gameplay/browser rerun, hosted auth/Convex integration or provider changes. No login, pairing, match writes, email, paid inference, DNS changes, new resources, customer-data operations, account/Convex edits or unrelated workspace changes occurred. Existing anonymous/account runtime evidence is not claimed as new installer release evidence.

Continuation: after the exact default-ref decision, recheck current refs and candidate identity, apply only the authorized correction, rerun literal-command acceptance, then publish only the approved guide slice through the established Vercel flow and verify both public aliases. Do not deploy the canonical repository wholesale or replace the live backend.
