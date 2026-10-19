# Saved-preferences recovery

Task: t_ce2e6589 · native Hermes · difficulty S (assigned before implementation).
Base: 610921587566c60c527024f365acc26d865f1b0d.

## Acceptance and decision (written before tests and implementation)

A returning local player must be able to enter, start a real house match and
reload the same match when `botters.prefs` contains unreadable saved preferences.
On the base, `opening: null` reaches `editor` and throws at `list.map`, before
`bootAccount` reveals local entry. A parse-only catch is insufficient.

Protect only restoration before the editor. Reuse the existing defaults and
`checkGambits` from `sim.js`; do not duplicate validation or change that module.
Malformed JSON and non-object roots use defaults. An absent opening retains its
existing default; an invalid supplied opening falls back independently, retaining
other settings. Valid strategies, including disabled rules and numeric parameters,
must survive exactly. No match-option validation redesign.

Recovery is in memory: loading must not remove or rewrite raw preferences, the
session, pairing data or unrelated keys. Only a subsequent actual settings edit
uses the existing `savePrefs`. Test with fresh browser contexts and synthetic data,
real loopback `server.js` sessions, no fabricated valid session token or game frame.
The regression must fail on the unmodified base, then pass after the narrow fix.

## Behavioral coverage and execution plan

Extend `test/offline-browser.test.js` using its real server/browser fixture:

- Main regression first: `{ "opening": null }`, no module error, usable entry,
  real session and advancing house match, reload retaining token and matchId.
- Truncated JSON; null/array/primitive roots; invalid, empty, excessive or unknown
  condition/action/parameter openings; preserve other valid settings.
- Positive controls: absent key and custom valid strategy with `on: false` and
  numeric `p`; inspect the editor and authoritative match gambits.
- Compare raw storage at load and after session/match/reload. Exercise a real
  settings edit after recovery and assert that normal saving resumes.
- Re-enter with a server-issued synthetic session already present: no replacement
  session request, no lost token. Keep unrelated local/session storage intact.

Run RED/GREEN targeted regression, full offline-browser and guided-first-match
suites, `npm run check`, `npm run build`, `npm test`, and `git diff --check`.
Use the shared browser-fixture lock for all browser/fixture suites. Dependencies
are the assigned read-only `node_modules` symlink; no install/download.
Execution results, failures and candidate identity belong in the wrapper evidence.

## Source discrepancy discovered while writing the regression

The requested literal `matchId` comparison cannot be exercised through the offline
API: `server.js` keeps an internal match id but does not expose it in `/state`
(lines 72–75 on the base). The old offline test compared two missing properties,
which was not identity evidence. Without changing the forbidden backend, both
tests now verify a real, unchanged session token, identical immutable planet-map
geometry, advancing authoritative ticks and (in the new regression) no new
`POST /session` or `POST /play` on reload. No matchId is fabricated. Literal id
verification remains an explicit scope limitation for coordinator acceptance.

The pre-fix run reproduced the null-opening `map` exception, truncated-JSON parse
exception and unknown condition/action `doc` exceptions. Empty/excessive/invalid
parameter openings also failed default-strategy assertions. Positive controls
already played and reloaded correctly. The first post-fix run passed all 17
fixture cases (18 Node test results including their parent).

Final browser checks also preserve a synthetic pairing value and unrelated keys
in local/session storage. The offline plus guided suites passed 21/21 results;
syntax check and production asset build passed. The first full `npm test` run
passed 127/128, failing the untouched live-wire admission assertion (401 rather
than 429). An unchanged-source full retry passed 128/128. Both logs are retained;
the intermittent failure is not described as fixed by this preferences change.

## Boundaries and remaining gates

Only this note, `index.html` (sim import and restoration hunks), and
`test/offline-browser.test.js` may change. `index.html` is a known file hotspot
with result-sharing, not a functional dependency. Preserve all other features.
No account/auth/backend/client/provider changes, network installation, push, PR,
merge or deployment. Independent Luna review and exact-candidate Sol rendered
review remain coordinator gates, not implied by these automated checks.

Synthetic corruption demonstrates a reproducible startup defect, not its real
incidence, human enjoyment or adoption. Globally forbidden/quota-full storage is
out of scope; session/pair storage accesses are deliberately unchanged.
