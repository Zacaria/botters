# Botters swarm-depth review — CHANGES_REQUESTED

Candidate: 00fc4b6c4aa6574dd38072143984a9dceb27f1e7
Tree: fd8fae9c26bf5983f107dce64510e419f0da3898
PR: https://github.com/Zacaria/botters/pull/18 (base pvp-online)
Scope: DESIGN.md, README.md, client.js, index.html, online/game.js, server.js, sim.js, test/online.test.js, test/sim.test.js.

Candidate checkout was clean and identity unchanged before/after verification. Git signature verified. PR head matches supplied commit and its Botters local checks CI is SUCCESS. Source remained read-only; tests/builds/probes ran in an archive copy at /srv/hermes-ssd/workspaces/botters/t_4c176b13-review. No release/deploy performed.

## Findings, in priority order

1. P1 — Mode buttons cannot select any new mode. index.html:432 (pick event handler), 550–552 (startPlay).
   All values other than vs and withAgent pass through unary +. Every mode string, including 1v1, becomes NaN; savePrefs serializes it as null. Server matchOptions falls back to 1v1. In real Brave, clicking each of 1v1/2v2/ffa4/ffa6 produced saved mode null and actual mode 1v1. This makes the principal new modes inaccessible through normal UI.
   Required correction: preserve mode as a validated string, keeping numeric conversion for numeric controls. Add a browser regression clicking every mode button, verifying selected state, persistence/reload and actual started mode. Verify queue/rooms remain duels.

2. P2 — Splitting bypasses morph cooldown and cocoon. sim.js:122–136, 140–143.
   addSwarm initializes morphAt=-1e9 and cocoon=0. split copies belly and meal but not these restrictions. Reproduction: morph an owned 1000-particle locust into carapace at tick 0; parent has morphAt=0, cocoon=60; split succeeds; child has morphAt=-1000000000, cocoon=0 and immediately morphs again successfully. The child can also move during its parent's three-second cocoon. This defeats the advertised 15-second cooldown, including in ranked duels.
   Required correction: preserve active morph restrictions across splitting; ensure merging cannot erase an active restriction either. Cover child movement and immediate re-morph with behavior regressions and deterministic replay.

3. P2 — Multiple attackers digest the same killed particles repeatedly. sim.js:227–236.
   hit caps damage against the target's initial n separately for each pair, but summed loss can exceed its population and every attacker receives half its unadjusted damage. In an isolated single tick, ten 1000-particle side-0 spores at (600+i/100,350) attack one side-1 1-particle locust at (630,350), with hold gambits and no nearby planets. Total population+belly rises from 10001 to 10005 after the target dies. Thus killing one particle credits five particles, not 0.5. Same-type attackers merge afterward, leaving one 10005-particle survivor; merging is not the source of the extra mass.
   Required correction: attribute only actual available killed population across simultaneous attackers; total digestion credit must be <= 50% of actual kills, with deterministic allocation. Test multiattacker/low-population deaths, nonnegative state and replay.

4. P2 — ffa6 always exceeds the requested map size. sim.js:105–111.
   Six homes plus batches of four neutral planets cannot land on the allowed totals (16,28,40). Reproduction seed 7: ffa6 requests 16/28/40 create 18/30/42; all other modes create exact requested totals. opts.planets still claims the smaller number. This changes resources and match settings silently.
   Required correction: generate the exact selected total while retaining the intended map symmetry, or explicitly reconcile mode-specific allowed settings across UI/server/docs. Add all mode/size combinations as assertions; no silent overshoot.

## Fresh verification

- npm test: 202 passed, zero failed/skipped.
- npm run check: success; 81 JS files plus inline scripts/JSON checked.
- npm run test:browser: 44 passed in Brave, 4.7 minutes.
- Independent Brave mode-picker probe: every click starts 1v1 (finding 1).
- Four complete Brave matches (1v1, 2v2, ffa4, ffa6), using valid saved mode preferences to bypass only the broken picker: completed to time, report displayed, zero pageerror events. P/L/C changed three different swarms to spore/locust/carapace successfully. Hunger values and orange-red rings observed. Team allies and 1/3/5 opposing-team totals present as appropriate.
- Inspected review-play-1v1.png, review-play-2v2.png, review-play-ffa4.png, review-play-ffa6.png: visible camps differentiated by colour, own types by circle/triangle/square, hunger rings visible. No additional release-blocking visual issue; some long HUD text clips. Full-match captures and end captures retained alongside report.
- Independent replay with morph/order/split inputs: final full state deep-equal to replay for all four modes (seed 7; 4/4/4/3 successful logged inputs respectively).
- Reviewed online/game.js and server.js rematch/rooms/Elo/reports; duel restrictions and multi-team result mapping present. Existing duel/room/browser regressions passed. No production access or active-room check attempted; deploy is outside review and still requires zero active rooms after a PASS.

Evidence: review-npm-test.log, review-check.log, review-playwright.log, review-browser.mjs, review-browser-results.json, review-browser.log, review-sim-probes.log, review-mode-pick-*.png, review-play-*.png, review-ended-*.png.

Next: owning implementer fixes these four findings and returns a new signed exact candidate; independent review remains required before release.
