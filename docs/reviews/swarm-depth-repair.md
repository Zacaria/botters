# Swarm-depth repair evidence

Base: signed candidate `00fc4b6c4aa6574dd38072143984a9dceb27f1e7`, PR #18 (`feat/swarm-depth` → `pvp-online`). This record accompanies the repair commit; the Kanban handoff pins its full SHA and tree. No deployment or production access was performed.

## Findings and repairs

The original independent report is preserved verbatim in [swarm-depth-00fc4b6.md](swarm-depth-00fc4b6.md). Its screenshots and full-match captures remain in `/srv/hermes-ssd/workspaces/botters/t_4c176b13-review`; they are evidence of the old candidate, not this repair.

1. Mode picker: resolve the clicked value against the control's allowed typed values instead of coercing strings to numbers. The same path preserves booleans and numeric controls. Brave tests click every mode, inspect selection and stored preferences, reload, start a match and assert the server's actual mode, planet count and opposing teams. Queue and private rooms still start duels even after selecting `ffa6`.
2. Morph restrictions: split children inherit both timestamps; merging takes the latest of each timestamp. Behavior tests check movement remains blocked through tick 59 and resumes at tick 60, and remorph remains blocked through tick 299 and resumes at tick 300. Merge tests exercise either survivor ordering.
3. Kill accounting: collect simultaneous hits, then attribute only the target's available population proportionally to those hits. Credit half the attributed kills, clamp losses at zero and prevent dead swarms from digesting. Tests exercise ten attackers against 1-, 3- and 100-particle targets, with and without friendly merging, deterministic equal shares, and mutually killed swarms with existing bellies.
4. Map totals: six homes are followed by a mirrored centreline pair, then four-way neutral copies. All 12 mode/size combinations assert exact totals, mirrored positions and equal mirrored resources over 100 distinct seeds (including seed 7). An additional probe checked 1,000 seeds per combination: 12,000 exact totals.

## Red / green evidence

Before runtime changes, the new Node file ran 26 tests: 12 passed and 14 failed, covering all three simulation findings plus morph replay sequences. A focused corrected combat assertion reproduced `credited 5 for 1 kills` and `credited 15 for 3 kills` against the original source. The four actual-button Brave mode tests all failed because no selected mode remained after clicking. The original report also records the null stored value and actual `1v1` fallback.

After repairs, all 26 new Node regressions pass. Full-state morph/split/automatic-merge/order/remorph replays match for all four modes, including refused early morph inputs.

The first full Node run exposed one stale assertion requiring a particular 2v2 replay to reach its time limit. With corrected kill accounting, seed 5 legitimately wipes team 0 at tick 2095: no team-0 swarms or owned live planets remain. The assertion now compares the entire replay with an independently stepped live match, rather than requiring a time-limit ending. The dedicated time-limit tests remain intact.

An initial new duel browser test read a room code before room creation finished. Waiting for the room panel and the joined code fixed the test race; no runtime room code changed.

## Verification

- `npm ci --ignore-scripts`: 199 packages installed; audit reported zero vulnerabilities.
- `npm test`: 228 passed, zero failures/skips (fresh rerun after correcting the stale assertion).
- `npm run check`: 83 JavaScript files, inline browser scripts and JSON checked. The repository configures no separate lint, type or formatting tool.
- `npm run build`: succeeds; shared UI/simulation public bytes are checked against source before handoff. Existing Node tests also verify clean-build/package media and public-file boundaries.
- `npm run test:browser`: 49 passed in Brave, no retries/skips, including five new mode/duel tests. Runtime and browser-test sources were final for this run; the subsequent edit changed only the Node replay assertion above.
- `npm run test:auth:browser`: 4 passed in Brave. Its invalidated/stolen live connection test logs the expected `Sign in again to connect to live play` denial and socket close; the suite succeeds.
- `git diff --check`: clean.

No files were deleted. Removed the lossy generic picker coercion, unbounded duplicate kill credits and a stale fixed-duration replay assumption. No standalone remote online verification or separate Convex Vitest suite was run; no production room query or deployment was attempted.

Next release step: independent exact-candidate review on `t_4c176b13`, then the authorized release lane must confirm zero active Lightsail rooms immediately before deployment. This repair is not a review PASS or release approval.
