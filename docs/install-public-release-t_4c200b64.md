# Public installer release — t_4c200b64

Status: PASS. The literal default-ref installer works and both public guide aliases serve the exact reviewed guide. This supersedes the initial default-ref/publication blocker in `install-release-t_4c200b64.md`.

## Authority and identities

- Independent reviewer t_d0bc2c37 approved signed installer `8871d4842eaf900362052ea1ed3879027a1fa5aa`, tree `c56ffbb21c708ccec2ec9b412e0d70e2b84beda2`.
- The default agent's owner-authorized card comment records changing the GitHub default from master to pvp-online. This release operator did not perform that mutation. Fresh GitHub API and `git ls-remote --symref` readbacks confirm pvp-online at the approved installer; master remains `42e711776b516b35fde2301544f7ee3b398b88d7`.
- Existing Vercel production `dpl_6iiTcKpKepiQGzuLq29ojxoHyL4G` identified source `5f34d62cd2dbbe55d98da5f83b7194b962c12230`. A minimal guide-only deployment branch starts at that exact live source, not the installer branch or unrelated active account-cost work.
- Signed guide release `fee0fabd6d88c3b0757955f14598c72831219125`, branch `release/install-guide-t_4c200b64`, changes only `guide.html`, whose blob is identical to the reviewed installer guide. All 113 other uploaded source files match the prior production deployment's SHA-1 file identifiers. All 114 new deployment source files match the dry-run input manifest.
- Production deployment: `dpl_9HK6CKcZTjSsRegbCN5LXUT4sQ31`, unique URL https://botters-ej1s464lq-zacaria-chtatars-projects.vercel.app . Project `prj_AjBus0nBvZlNUIloFiOi96s0Plnl`, team `team_lpN3ikyEWpXFfrV53eNYNWQd` unchanged. Deployment metadata identifies the guide SHA and approved installer separately.

## Literal public installer acceptance

The unchanged `scripts/verify-install.js` was executed in memory, adapting only the setup argv to `npx -y github:Zacaria/botters install ...`, cache to `.cache/release-default-npm`, label and evidence output. A fresh HOME with spaces and empty dedicated npm cache used Node v24.21.0, actual Claude Code 2.1.285 and Codex 0.159.0.

PASS: literal `npx -y github:Zacaria/botters install --yes`; both real CLIs read registrations; each configured MCP exposes all seven tools; byte-identical no-op rerun without new backups; offline-only update; targeted uninstall and repeat uninstall. No login, pairing or match writes were invoked. The locally packed comparison MCP also exposes seven tools. JSON package shasum/integrity describe that local comparison tarball, not the downloaded GitHub archive. Acceptance ran at evidence-only HEAD `3c0ef25fab9143c851ad841148942bd2e46aac39`; recorded implementation hashes match the exact approved candidate.

Codex emitted the previously observed warnings about nonexistent fresh CODEX_HOME at version probing and refusal to create PATH helper aliases under temporary storage. Installation/readback/MCP checks still passed. Its CLI JSON omits the approval-policy field; actual TOML has `default_tools_approval_mode="approve"`.

## Exact release commands

Inside this task's existing isolated linked worktree:

    git switch -c release/install-guide-t_4c200b64 5f34d62cd2dbbe55d98da5f83b7194b962c12230
    git show 8871d4842eaf900362052ea1ed3879027a1fa5aa:guide.html > guide.html
    git diff --check
    git add guide.html
    git commit -m "docs: publish reviewed one-command installer guide"
    git verify-commit HEAD
    git push origin HEAD:refs/heads/release/install-guide-t_4c200b64
    git ls-remote origin refs/heads/release/install-guide-t_4c200b64
    npm ci
    BOTTERS_LIVE_URL=https://play.botters.havesomecode.io BOTTERS_REQUIRE_ACCOUNT=1 npm run build
    npm run check

Vercel CLI 64.2.0 executable `/home/hermes/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js`:

    node <cli> deploy --dry --json --project prj_AjBus0nBvZlNUIloFiOi96s0Plnl --scope zacaria-chtatars-projects
    node <cli> deploy --prod --skip-domain --yes --project prj_AjBus0nBvZlNUIloFiOi96s0Plnl --scope zacaria-chtatars-projects --build-env BOTTERS_LIVE_URL=https://play.botters.havesomecode.io --build-env BOTTERS_REQUIRE_ACCOUNT=1 --meta bottersInstallerCandidate=8871d4842eaf900362052ea1ed3879027a1fa5aa
    node <cli> promote botters-ej1s464lq-zacaria-chtatars-projects.vercel.app --yes --scope zacaria-chtatars-projects

Immediately before deployment, assertions verified clean HEAD, the one-path diff, guide blob parity and current remote default/candidate refs. Good SSH signature fingerprint: `SHA256:aSUe6Xvs+Cb6yJp/s++7LiozJ+LfaYmWxhe3W34YGGQ`. Tool timestamp before deployment: `2026-10-16T15:21:03+00:00`.

The staged deployment passed exact-byte asset checks, 114-file source manifest parity and two Brave guide cases using only the project's existing automation-bypass credential scoped to that deployment hostname. Both public aliases remained on the old deployment until promotion; the CLI assigned only its automatic project alias during staging.

Before promotion, the established production `ConvexStore` performed only the internal read-only aggregate `store:legacyActivity`: `activeMatches=0`, `complete=true`, `scanned=9`, `latestActiveEndAt=0`. The production endpoint was matched against the existing fixture before using its credential in memory; Vercel env readback omits the sensitive key. No credentials were logged or written. Initial API version/authentication attempts failed without writes; the existing store wrapper supplied the correct authenticated query. Live health also reported zero matches. Gate timestamp `2026-10-16T15:25:21.926039+00:00`; immediate pre-promotion signature/clean-identity recheck timestamp `2026-10-16T15:25:22+00:00`.

## Public verification

Ordinary unauthenticated strict-TLS requests, no bypass, verified both https://botters.havesomecode.io and https://botters.vercel.app after promotion at `2026-10-16T15:25:33.225405+00:00`:

- Both aliases identify `dpl_9HK6CKcZTjSsRegbCN5LXUT4sQ31` and guide source `fee0fabd6d88c3b0757955f14598c72831219125` through provider readback.
- Seven assets per origin match the local production build exactly: home, guide, sim.js, privacy, terms, live-client.js and live-config.json. Only the guide differs from the former production assets. Guide SHA-256: `cd9482effb5c659abf0b147f309bb24678764d578db54520419b9229cc34cf31`.
- Website `/session` returns 401; retired `/play`, `/rooms`, `/lobby` retain their prior 410 moved-to-live response; anonymous `/account` returns 200 with `required=true`; unknown static route returns 404. An initial test expectation of 401 for the retired website routes was corrected to the observed unchanged baseline 410 after inspecting `controlOnly` routing; no source was repaired.
- Brave public checks at `2026-10-16T15:25:38.132Z`: four cases pass, both origins with JavaScript enabled and disabled. The exact public command copies to clipboard, manual fallback is collapsed then opens, permission/backup/restart/uninstall explanations are visible, and no page errors occur. Browser contexts and processes were closed.
- https://play.botters.havesomecode.io/health remains healthy on `5f34d62cd2dbbe55d98da5f83b7194b962c12230`, Colyseus, zero matches. Its reported Convex counters remain query 60 / mutation 9 / subscription 10 / updates 18. Live hosting was not deployed, restarted or reconfigured.

Structured command acceptance, source identity, staging/gate and public HTTP/browser results are retained in `install-public-release-t_4c200b64.json`.

## Scope, warnings and omitted checks

The current run's guide-only source passed `npm ci` (zero vulnerabilities), build, syntax checks on 67 JS files and `git diff --check`. Earlier reviewer and release checks on the exact installer passed 78/78 tests, 71-file syntax checks and focused Brave tests; those full Node tests were not repeated in this continuation. Existing esbuild/msgpackr-extract install-script approval warnings remain, with no permissions changed. Vercel also warns that `node >=22` can follow future majors and about npm cache-dir configuration; production build succeeded.

No fresh full gameplay, login/email/OTP, agent pairing, native macOS/Windows GUI or hosted auth-integration run is claimed. Those unchanged flows retain their prior evidence; this release changed only the reviewed guide in production. No account-cost candidate was integrated. No Convex code/schema/data mutation, live-host change, DNS change, new resource, subscription, customer operation, outbound message or paid inference occurred. No source files were deleted. The existing installer verifier removed only its temporary client HOME fixtures.
