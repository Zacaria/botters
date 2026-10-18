# Account-cost successor release preflight — t_bd78af25

Recorded 2026-10-18T21:12:18.123771+00:00. This is release preparation, not a production result.

## Candidate and accepted authority

Independent review t_001b030b PASS binds signed candidate f415cd77c2e7cf974babee4047cc93e34555fd2a, tree 0c5bebb07b8379bf3deaf4da021cbfde666f4766. Release verified its signature, clean checkout, archive SHA256 d4b65b778d0204328a86aecbdf776a3fc5f470ba1b2ad209c2f3f33d46b8d2fd, base diff fingerprint, and ancestry. Remote pvp-online remained 3e0c15df37b584c2a688332a09759495c4a71bf0; the scoped source branch matched the approved candidate.

The default operator's current release-card note explicitly reconciles the owner's existing deploy decision to this successor. Exact effects remain fast-forwarding pvp-online, deploying to existing Convex fastidious-kookabura-364, replacing only existing Lightsail Botters, and acceptance through existing test accounts. No new spending, migrations, email, DNS, provider or sibling changes. Do not re-request the settled successor rollout authority.

## Current prerequisite and handoff

GitHub branch protection has strict Botters local checks from Actions app 15368, with administrator enforcement. Exact candidate has zero check runs and statuses, and no candidate PR exists. Existing workflow triggers only on pull_request. Offline independent PASS is not that required remote check. No push, protection bypass, fabricated check or deployment was attempted.

Task t_dcc60e40 is assigned to default and was accepted/running. It must obtain the existing required exact-head check via the authorized PR/CI path without changing candidate or protection. It has no dependency on the release it repairs; release consumes its verified check result. Recheck identity, remote, current protection/checks, legacy aggregate and zero live rooms before release mutation.

## Executed checks and public boundary

Fresh npm ci --ignore-scripts --no-audit --no-fund installed 199 packages. Explicit BOTTERS_LIVE_URL=https://play.botters.havesomecode.io BOTTERS_REQUIRE_ACCOUNT=1 npm run build and git diff --check passed. No full local suite was repeated; fresh exact-candidate independent review evidence is retained upstream.

Public reads compared all seven generated files on each of the two website aliases: 12 of 14 match, with both homepage HTML files different from the R1 successor. No Vercel release was performed or claimed. Reconcile website-specific scope if required; current rollout note names GitHub, Convex and Lightsail, not a website deployment. Public live /health remains healthy on 5f34d62cd2dbbe55d98da5f83b7194b962c12230 with zero active matches. Existing tailnet SSH showed game botters-account:5f34d62 and unchanged Caddy caddy:2.10.2-alpine.

No hosted cost window or acceptance writes occurred. Cold50/warm48 remain inherited isolated results, not hosted or universal claims. No source, player records or dependencies were deleted.

## Durable evidence

Release-card attachment 242, successor-release-preflight.zip, contains successor-release-preflight.json and successor-ci-gate.json. SHA256 89e01cd228209a44a1e1590e751fa5a496dbb10a78eb7dd19070547099820cac. Durable attachment readback was byte-identical to both local JSON inputs, and ZIP CRC passed. Upstream candidate bundle/evidence/review attachments remain on t_001b030b. This evidence-only commit is not a release candidate and must not replace the reviewed SHA.
