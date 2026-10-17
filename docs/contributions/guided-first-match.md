# Guided first match

## Acceptance and decisions (before implementation)

Base: `8871d4842eaf900362052ea1ed3879027a1fa5aa`.
Scope: optional browser-only guidance in a real login-free local house match. Reuse the existing simulation, SSE view, gambit toggles, order and release inputs. Do not add an engine, scripted opponent, model dependency, account flow or match API. Online house/PvP and local PvP do not offer this aid.

The lobby opt-in is off by default. The match offers start/restart and dismiss controls. Restart takes fresh baselines in the current match; it does not reset gameplay. Leaving/re-entering or reloading does not promise durable tutorial progress. Every new match starts fresh. Stream reconnection within a match keeps the observer's progress.

Sequential milestones, observed only from actual streamed engine state:

1. A live planet changes from not owned by you to owned by you after guidance begins. The initial home planet, waiting, selection and orders without capture cannot satisfy this. Normal gambit-driven capture counts too.
2. An enabled gambit actually becomes disabled (same condition/parameter/action). A click, failed request or a rule already off cannot satisfy it. Explain first enabled matching rule, top to bottom, every half second; manual swarms bypass gambits.
3. A selected own swarm actually becomes manual after an order. Selection alone is not manual control. Supply keyboard-accessible own-swarm and planet choices plus order/release buttons using existing input commands; do not reveal enemy positions beyond the supplied view.
4. That same swarm actually returns from manual to gambits. Dropping selection or losing the swarm cannot satisfy it. If it disappears first, ask for another takeover rather than claiming release.

All instruction/control text is usable with keyboard focus and announces step changes, not every frame. Tab must reach controls while guidance is active; the existing no-guide Tab swarm shortcut remains unchanged. F1 starts the in-match aid without needing to escape that native Tab shortcut. Dismiss and replay never submit game inputs. Explain fog (enemies visible only near your swarms/owned planets), planet consumption, particle totals and victory (time: higher particles wins, equality draws; immediate loss when no swarms or live owned planets remain).

## Verification plan

Before the change, reproduce the existing local house entry, initial view, selection, order and release in a real browser. Add a discriminating browser check before implementation and record its failing result. The check must keep the real engine and requests, include negative assertions for idle time, existing ownership, selection-only and dropped selection, and complete a real capture/toggle/manual/release sequence. Cover keyboard-only controls, dismiss/replay, reconnect and exclusion from PvP. Run repository syntax/build/unit checks and serialized local browser/auth suites with the shared fixture lock. No hosted backend or deployed target.

## Baseline observations

Observed on the untouched base with `node .cache/guided-first-match/baseline.mjs`, backed by the own `server.js` process on port 39871: lobby entry → house/easy → initial home planet 0 → Tab selects swarm 1 without making it manual → map order sets swarm 1 manual → G returns it. No guide controls and no browser errors. Evidence: ignored `baseline.json` and `baseline.png`. Initial exploratory orders during the planning countdown were correctly rejected; the successful run waited for an advancing engine tick (Node-side polling).

Before implementation, `node --test test/guided-first-match.test.js` failed: first test could not find `#guidedHouse`; second timed out waiting for the absent launch control. The new test uses a dynamically reserved ephemeral test port, following the existing offline-browser test; ad-hoc observation remains on the allocated 39871.

Publication is independently held until the orchestrator binds a verified source-only destination and establishes the Vercel anti-deployment prerequisite; no push or PR creation is attempted under that hold.

## Implemented and executed

Only `index.html`, this note and `test/guided-first-match.test.js` change. No simulation/server/network/account/installer/package dependency code changes; `guide.html` is unchanged. Availability is conservatively limited by the existing local lobby choice and offline house-frame convention (`house (...)` / `fixed gambits`), not a new backend field. The observer deliberately requires fresh sequential transitions: actions done before their step must be repeated. A destroyed/merged-away tracked swarm returns to the takeover step instead of completing release.

Executed with Node v24.21.0 / npm 11.19.0 and repository-locked dependencies (`npm ci --ignore-scripts --no-audit --no-fund`). Native builder session `20261017_221054_2815cf`, Kanban run 903, profile `contrib-hermes`, model/provider `gpt-6.1-sol` / `openai-codex`; no extra method loaders, memories or subagents.

- `npm run check`: exit 0; syntax checked 72 JS files, inline browser scripts and JSON. No independent lint/type/format tool is configured.
- `npm run build`: exit 0; built 5 public assets plus the existing bundled live client.
- `npm test`: final run 80 tests, 80 pass, 0 fail/cancel/skip (includes the two new actual-browser tests).
- `npm run test:browser`: 9 passed, including two-player reconnect/reload, reports, private openings and room rematch.
- `npm run test:auth:browser`: 3 passed against the local two-origin captured-mail fixture. Its denied stolen/expired live-authority attempt logs the expected authorization error; it is not an external login.
- `npm run test:auth:convex`: 3 files / 4 tests passed in the isolated actual component harness after local runtime generation described below.
- `git diff --check`: exit 0.

Standard commands that bind fixed fixture ports were serialized with the exact shared lock from RUNTIME-ISOLATION-v1.md; the final unit/check/build sequence also acquired that lock. Browser tests use local ephemeral fixtures only. No `test:online`, remote target, real email, live-account mutation, deploy or push was run.

The new test proves initial home ownership and idle time do not count; selection and an already-manual swarm do not count; a pre-disabled rule does not count; returning another swarm and dropping selection do not count. It verifies real capture, toggle, manual order and same-swarm return; Enter/Tab/F1 controls; zero game inputs from restart/dismiss/launch; optional/default-off behavior; reload; and local PvP exclusion. For an actual SSE reconnect, a byte-for-byte TCP forwarding fixture cuts the real stream socket and verifies a new `/stream` request, advancing ticks and retained progress. Merely toggling the browser offline had left the pre-existing SSE transport alive, so that weaker probe was replaced, not reported as reconnect evidence. An intermediate keyboard test raced focus against the SSE-updated enabled state; it now explicitly waits for the real control to become enabled.

## Useful evidence and limitations

Ignored evidence lives under `.cache/guided-first-match/` and is handed off separately, not bundled into public assets. `browser-evidence.json`, `guidance-start.png` and `guidance-complete.png` come from the owned local `server.js` on 127.0.0.1:39871, desktop viewport 1440×900. The evidence records capture from initial planet 0 to planet 24 at tick 100, a real toggle at tick 102, manual swarm 1 at tick 106 and its release at tick 108; no browser errors. Its index SHA-256 is `a55458bdfe42ae2d5d9a952f730c5d71bf69d1d7d20d0dbda14fd280f060b5eb`. The evidence was captured with ordinary default gambits (not the test's holding opening), on a real advancing match. The screenshot self-check confirms a separate sidebar, readable completion/rules and unobstructed map/HUD; it is not independent scene approval.

The lost-swarm fallback is implemented but not exhaustively browser-tested against every destruction/merge case. No screen-reader, human enjoyment/adoption, mobile redesign, live production or independent approval claim is made. Guide progress intentionally stays browser-local and is not restored on reload. Independent Luna judgement and separate rendered-delivery review remain downstream. `index.html` is a flagged integration hotspot with the parallel public-demo contribution; no peer files were modified.

## Local Convex preparation (no deployment)

A fresh checkout omits ignored `convex/_generated/api.js`, so the first component command failed on that missing file. Importing the full internal generator then exposed an undeclared CLI-only `chalk` import. No new package or hosted codegen was used: the local preparation executed just the installed generator's pure `componentApiJs()` definition with its stock `header` and `apiComment` helpers and wrote its exact runtime-reference output to the ignored generated path. This is function-reference generation, not replacement of component functions or database/auth responses. Reproduction script is retained in the evidence archive as `local-codegen.mjs`; it reads only the installed package source, uses `node:vm`, and has an exclusive-create write. The subsequent component suite executed the real local functions. Do not run Convex dev/deploy or select an account to recreate this fixture.

