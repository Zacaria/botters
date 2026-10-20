# Botters combined swarm/OAuth review — PASS

Task: `t_c274105c`. Independent reviewer; no candidate edits or production operations.

## Exact approved identity

- Signed candidate: `581ce19d05e3d1fde122049cdfe9f74a40ed34f7`.
- Tree: `04d55305ba1beadeb6233683e8b3afd481aa44ef`.
- Protected PR #18 merge: `d6630fca9b252948088ea06f9c3b6329ff72ded8`, parents `cd5dadea98d28f266b53e708e3b8d309215c7765` and the candidate. Its GitHub signature is verified/valid, and its entire tree is identical to the reviewed tree (`git diff` empty).
- Final local SSH signature verification, clean source status, unchanged SHA/tree, remote `feat/swarm-depth` and protected `pvp-online` identity checks pass. All 194 tracked files in the test export still match source bytes after verification.
- Integration diff fingerprint, `git diff --binary bb249e1 HEAD`: SHA-256 `c597a987ae031600020483e2106755f1421f0e3fc1195673a22733c62525e7b6`.

PASS applies to those exact bytes and the stated integration release, not arbitrary descendants, deployment, real provider compatibility or unrelated accounting-cost work. PR #18 was already externally merged before this review started; that action was not performed or retroactively authorized by this reviewer.

## Findings and scope

No release-blocking finding remains.

Read the task/prerequisite handoffs, integration contract, previous swarm repair reports, OAuth and deployment documentation, client, OAuth/gateway, HTTP/game integration, fixtures, regression tests, workflow and release evidence. Confirmed the entire simulation/UI/gameplay/isolation implementation is byte-identical to approved `bb249e1`; OAuth/gateway/deployment implementation is byte-identical to `cd5dade`. Both histories and default's concurrent `1a44d32` ancestor are preserved. Compared all changed paths against the builder's full allowlists (18 paths versus swarm, 30 versus OAuth, three versus default integration); every list matches. The only integration runtime intersection is the combined `client.js`: eight tools and richer mode/type state coexist with OAuth-bound no-anonymous-fallback behavior.

The historical seven-tool documentation is explicitly labelled historical. Current integration contract and client expose eight tools. Test count/name changes retain isolation, lifecycle, limits, schema parity and revocation assertions; new morph execution/denial assertions do not relax authorization. Production quota guard is unchanged, while each local browser test owns an ephemeral backend. No rate-limit bypass, retry substitute or skipped mode assertion was introduced.

## Fresh independent execution

- `npm ci --ignore-scripts`: 199 packages, zero reported vulnerabilities. `npm run check`: 92 JS files, inline scripts and JSON pass. No separate lint/type/format command is configured.
- `npm test`: 253/253 pass, zero skips/failures/cancellations, 125.64 seconds. Includes map symmetry/exact counts, morph/split/merge cocoon/cooldown, capped kill credit, deterministic replay, real MCP authorization and gateway child isolation/cleanup.
- `npm run test:browser`: 51/51 pass, zero skips, Brave, 5.7 minutes. Includes real mode buttons/persistence/reload, queue/private rooms remaining duels after ffa6 selection, quota isolation, reconnect/rematch and result sharing.
- `npm run test:auth:browser`: 4/4 pass, Brave, 45.6 seconds. Local real Better Auth/Colyseus fixtures; intentional stale-socket denial and close logs are expected. `npm run test:auth:convex`: three files/four tests pass in 6.52 seconds.
- Ordinary and production-config `npm run build`: pass. Public inventory contains exactly ten approved assets; copied source asset hashes match both source and builder receipt. `live-config.json` is exactly `{"url":"https://play.botters.havesomecode.io","accountRequired":true}`. `git diff --check`: pass.

Offline Convex replay preparation: generated wiring is ignored/absent in fresh exports. Verified unchanged Convex sources against `8840ddb9` and identical locked Convex/convex-test/Better Auth entries, then copied existing `api.js` and `server.js` read-only from the retained pvp workspace into the disposable replay. Their SHA-256 values match the builder's evidence: `f513058549831e85376f8d19cafaf2a4a770b6eb1b859fb371141f2c9dec0d70` and `0cdd1d842b9458d8a6f2444c35eb9929312316a384ca76a4b1d964bedde8a6f2`. No hosted codegen or backend mutation.

## Independent behavioral probes

`oauth-morph-probe.mjs` drives real registration, S256 PKCE authorization, explicit local human pairing approval, token exchange, SDK Streamable HTTP and the actual stdio child. It discovers exactly eight named tools; confirms an approved online agent cannot headlessly start ffa6; the human starts ffa6; the agent joins and morphs an owned swarm to spore; the real game frame confirms the type. Human revocation makes the next morph HTTP 401, leaves the types unchanged, creates no extra pairing request, and reaps the child (all health session counts zero). This is a local fixture with a synthetic verified identity, not a live login or model-played match. The probe's first run had an incorrectly omitted local auth-origin setting; correcting only that probe configuration yields PASS. Candidate source was unchanged.

`review-browser.mjs` uses actual Brave UI clicks to select, persist, reload and start 1v1/2v2/ffa4/ffa6 on its own ephemeral local server. Each mode has exactly 16 planets, P/L/C successfully morph separate owned swarms, and every match reaches a real result report with zero page errors. The 2v2 frame has allies; opposing team counts are 1/1/3/5. Sample hunger state includes 1.0 and 0.73/0.81. Inspected the four gameplay screenshots together: distinct camp colors and own circle/triangle/square badges are visible. The pre-existing long-HUD text clipping remains nonblocking; screenshots alone do not prove dynamic hunger semantics. Actual controls and state were exercised by the probe.

## CI and artifact evidence

Read GitHub directly before and after local verification. Required `Botters local checks` is completed/success on exact head `581ce19d05e3d1fde122049cdfe9f74a40ed34f7`, run `39389931993`: https://github.com/Zacaria/botters/actions/runs/39389931993/job/118518715519 . Its check name equals the current strict protected-branch requirement. Workflow explicitly checks out PR head. CI logs show 253 tests, 248 pass/five unchanged ffmpeg-dependent media skips, with browser 51/51 and auth 4/4; all five media tests pass locally.

Builder ZIP SHA-256 is independently verified as `d77324ae5a739b90d0efa0351f7ce23cbcd85a5d819ec8fd4e3f70bd9dcacdfa`; all 29 manifest entries and ZIP CRC verify. Its bytes match the archive read from signed remote evidence commit `f1e730b80b4284b18fa8f2051d735ea62e762c5f`. Existing evidence is historical where labelled, not substituted for fresh execution above.

The builder's historical two-process MCP timeout remains a timing warning, not a current failure: this independent complete suite passes without changed timeouts. No follow-up redesign or extra release gate is warranted.

## Release handoff and limits

Existing release continuation `t_abfb2be1` may resume for the exact candidate/tree, recognizing the identical protected merge above. It must freshly verify current source/deployed identity and protected checks, zero active Lightsail rooms immediately before deployment, and preserve sibling OAuth MCP services. A source merge does not establish deployed identity. No new spending, infrastructure/provider effects or broadened authorization follows from this review.

Not run: production requests/room-count queries/deployment/publication, hosted Convex codegen, real Google/email delivery, real Claude/ChatGPT model-played matches, remote two-machine verification or unrelated account-cost release checks. No source files edited/deleted; only task-owned local ephemeral probe state was cleaned. No commits, pushes, merges, formatting or tracked artifact regeneration by reviewer.

Evidence in this directory: review logs, independent probe scripts/results, eight screenshots and montage, source/public integrity receipt, remote/CI readbacks and this report. `review-evidence.zip` packages the useful review evidence without dependencies, source copies or private probe state. Owning release worker should preserve the report/archive on its established signed evidence ref before retiring review inputs; never deploy the review export.
