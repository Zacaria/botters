# Authentication candidate verification

## Retained boundary

Runtime candidate: signed/pushed `1dced5930f85f9a51e993492b6d3e6fabcdddaee` on `origin/pvp-online`, verified by `git verify-commit` and exact remote ref readback. Compare against `50018f8` (reviewed public-policy baseline). Thirty changed paths are listed by `git diff --name-only 50018f8..1dced593`; this includes docs/tests and the lockfile. No files, databases, legacy ratings or user records were deleted or migrated. Name-only online access is replaced in the candidate, not adopted into accounts. Offline code remains login-free.

Chosen implementation and callback contract: `auth.md`. The policy-only public release remains `dpl_3DJ62FpRQzy1MgKjDdTyk4XddrvC`; both public Vercel aliases were inspected after staging and still resolve there. Do not promote the auth preview as though provider acceptance were complete.

## Fresh local execution at the candidate

- `npm ci`: succeeded; lockfile install is reproducible. Installation warns that esbuild's postinstall is not covered by allowScripts; actual codegen/build/tests still ran successfully.
- `npm test`: **53/53 passed**, including real Better Auth password/verification/reset/logout HTTP tests, explicit ownership/pairing/revocation tests, atomic concurrent password throttling, account-ID Elo across renames, house exclusion and two actual stdio MCP processes paired to verified accounts and completing an accelerated match with reports/history/Elo.
- `npm run test:auth:convex`: **1/1 passed**, actual official Convex component running in `convex-test`, through production proxy/session-resolution code. Only external Resend transport is captured; no provider login or email delivery is claimed.
- `npm run test:auth:browser`: **2/2 passed** in Brave: real-library signup/verification, wrong password, reset, resume/logout; two verified accounts, explicit agent approval, cross-account denial, reconnect/history/Elo and revocation.
- `npm run test:browser`: **6/6 passed**: four established gameplay scenarios and no-JS/mobile policy scenarios. `npm run check`: 48 JS files plus inline scripts/JSON passed. No separate lint, static type or formatting configuration exists; these are not claimed as independent passes.
- `npm run build`: five intended browser assets. `npm pack --dry-run --json`: ten offline-package entries, no auth server source, credentials, test fixture or dependencies bundled. `npm audit`: zero known vulnerabilities across installed production/development dependencies. `git diff --check`: clean.

Initial new account/rate tests failed against the old source. A later regression test caught house matches creating zero-game rating entries through fallback reads; eligibility now guards the entire rating read/write block, and the full suite was rerun after that repair. Early auth browser failures were incorrect test selectors (`#game` has fixed-position children and no visible box); tests now assert the real HUD. No failing run is counted as a pass.

Login and agent-approval screenshots were inspected. Copy/layout repairs remove an ambiguous solo heading and duplicate sign-in selector, label login-free local play explicitly, align real form labels, distinguish approval/decline and disable disconnect when no delegation exists. Screenshots are reproducible ignored evidence in `.cache/auth-login.png` and `.cache/auth-pair-approval.png`, without private credentials.

## Protected Vercel preview

READY preview `dpl_H4ZkbYx7uSRLz94BNoUpC2kKeN4X`:

https://botters-1s50jit7q-zacaria-chtatars-projects.vercel.app

The preview carries `gitCommitSha=1dced5930f85f9a51e993492b6d3e6fabcdddaee`. Protected HTTP readback verified exact `/privacy`, `/terms`, `/guide`, `/sim.js` source bytes. Homepage is exact source **plus** Vercel's single appended feedback-loader script, whose deployment ID matches this preview; it is not a raw byte match. The additional loader is not application source. Readback confirmed anonymous `/session`, `/play`, `/rooms`, `/lobby` are 401; `/account` is 200 with `required:true`, owned origin and null user. Server source, private environment filename and a nonexistent route return 404.

Real Brave preview inspection at 390×844: canonical sign-in link points to `https://botters.havesomecode.io/`, preview password form is hidden, policy links are visible, no horizontal overflow and no page errors. Preview intentionally has no production proxy secret/auth cookies and cannot complete a provider round trip. It must not be promoted directly: it was built for preview namespaces and lacks production-only auth configuration.

## Additive backend preparation and actual provider probe

Generated server/proxy secrets and `SITE_URL` were set only on existing Botters Convex; matching proxy secret and owned/backend origins were added only to Vercel Production. Convex values were read back and compared in memory; Vercel variable names/types/Production scopes were read back. No secret values were printed, committed or exposed in artifacts. Existing `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` were preserved and mapped directly. A private ignored 0600 recovery input remains for the active consumer; credentials can also be recovered from authorized Convex server configuration.

Convex dry-run: schema validation passed; no indexes deleted. Deployed the component/HTTP functions to the existing free-plan production deployment `fastidious-kookabura-364`, message pinning `1dced593`. The game `records` schema/store/crons are unchanged; no new cloud project or paid plan. Public frontend/API aliases were not switched.

Actual backend readback: direct unauthenticated `/api/auth/get-session` is 404; supplying the private proxy header returns 200/null. Actual configured Google authorization construction returns 200 with state and exact redirect URI:

`https://botters.havesomecode.io/api/auth/callback/google`

Fetching that Google authorization page returns HTTP 200 with sign-in UI; neither `redirect_uri_mismatch` nor `invalid_client` was observed. This is **not** a completed Google login, Branding/Search Console verification, or proof of consent publication. No Google account credentials were entered.

## Outstanding prerequisites and next release step

1. Transactional email: current Botters server configuration lacks `RESEND_API_KEY` and an authorized verified `AUTH_EMAIL_FROM`. A connector inventory attempt also returned CONNECTION_REQUIRED; do not infer access or reuse an unrelated project's key. Operator task **t_f0981eb7** owns configuration and actual delivery verification, without depending on this waiting implementation.
2. Independent source/security review: **t_c57e9135** consumes exact `1dced593`, independently of email setup. Findings must be repaired before public activation.
3. After those artifacts arrive, produce a **production-target, skip-domain** build from the reviewed candidate with production-only origins/secrets, validate real email/reset delivery and Google callback/branding state, then perform the authorized controlled cutover. Keep rollback handle `dpl_3DJ62FpRQzy1MgKjDdTyk4XddrvC`. Complete real Google and email/password signup/play, reset/logout, account reconnect and both-alias readback before claiming acceptance and routing final review. A real Google login may require the owner's browser; never ask for credentials in chat.

Operator's separate DNS finding: primary LAN resolver caches an old NXDOMAIN while secondary/public resolvers return the correct CNAME/A. Its strict-TLS forced-address custom-domain/source check passed, but ordinary primary-resolver availability remained unverified. Do not rewrite correct authoritative DNS. Public policies are already independently reviewed/published; this is not a Google activation claim.
