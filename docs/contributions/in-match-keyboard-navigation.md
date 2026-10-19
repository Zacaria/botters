# In-match keyboard navigation

## Scope and acceptance (written before product changes)

Base: `751a87afb48a11c9f79d741778b150ddf54b9a9f` (tree `056f7be8c94e4fcee52ae8f8f9bb7253115b13c5`). This is a small corrective keyboard-access contribution, not a new game mechanic or an accepted feature before integration.

- Reuse the offline browser fixture, real `server.js`, SSE and engine. Enter a local house match with optional guidance off. Preserve a browser RED on the unchanged product: bounded native Shift+Tab traversal cannot reach the controls because the global handler consumes it. Record actual focus and selection, not a mocked key event or a startup failure.
- After PLAY, use only Playwright's native keyboard presses for interaction: no click, `focus()`, injected key events or DOM/state setters to escape the trap. Read-only DOM/state observations are allowed.
- Plain Tab in the game/body context still cycles own swarms. Shift+Tab exits that context to native controls. Tab and Shift+Tab on native controls move focus without changing swarm selection. Explain that distinction in the existing command help; do not add a keyboard mode or focus-management infrastructure.
- Reach edit gambits, open and cancel its editor, traverse controls both ways, activate menu and RESUME MATCH with Enter/Space. Verify the same actual session token (never print it), identical immutable planet geometry and increasing engine ticks, with no additional POST /session or POST /play. Offline frames have no matchId: do not invent one.
- Preserve G/S/Escape/1–0/F1, native INPUT/TEXTAREA/SELECT behavior, optional tutorial launch/dismiss and guided Tab behavior. Keep tutorial milestones and engine semantics untouched.
- Preserve finished-result Tab/Shift+Tab, copy/rematch behavior and the existing 390px visible-map layout. Use existing regression checks where available; do not reimplement these features.

Only product paths allowed: `index.html`, `test/offline-browser.test.js`, this note. Keep dependencies and native assets unchanged. No guide, backend/auth, installer, provider/profile, deployment, push, PR or integration work. Evidence and a recoverable signed local candidate belong in the task wrapper's `evidence/`, outside committed source. Independent Luna/Sol and publication are coordinator-owned later gates; local tests are not human approval, exhaustive accessibility certification or production delivery.

## Minimal decision

Keep the existing shared key handler and its lifecycle/text-field/editing guards. Restrict only the swarm-Tab branch to unshifted Tab from the game context, allowing native reverse traversal and native control traversal. Reuse browser focus order and the existing command-help span rather than adding tabindex values, duplicate controls or a second tutorial.

## Executed local verification

Native Hermes session `20261019_085228_fdf5bc`, task `t_b75302b5`, run `962`, profile `contrib-hermes`. Checks used existing dependencies, explicit Node 22.23.2/npm 10.9.8, Brave, synthetic HOME, owned short TMPDIR and the shared browser-fixture lock. No remote backend or real account/client installation was used.

- RED: final test on byte-identical base `index.html` failed at the bounded Shift+Tab exit. All eight presses left focus on BODY while cycling swarm IDs 3/1/2. The final test file has the same checksum for RED and GREEN.
- GREEN: `node --test --test-name-pattern='in-match keyboard' test/offline-browser.test.js` passed. Native keys reached menu/edit controls both ways, opened/cancelled the editor, launched/dismissed F1 guidance, preserved field keys and game shortcuts, then resumed the same session and 28-planet geometry. Ticks increased from 2 to 48; one session POST and one play POST total, none added by resume. No offline matchId was assumed.
- `node --test test/guided-first-match.test.js`: 2 passed, including engine-confirmed milestones, reconnection and no local-PvP guidance.
- `npm test`: 129 passed, 0 failed. `npm run check`: passed (80 JS files plus inline scripts/JSON). `npm run build`: passed (8 public assets).
- `npm run test:browser -- --output=../evidence/browser-artifacts --reporter=line`: 32 passed. Existing finished-result native traversal/copy/rematch checks and all six 390/1440px layout checks passed; captures and geometry are retained outside source.
- `npm run test:auth:browser -- --output=../evidence/auth-browser-artifacts --reporter=line`: 4 passed. The expected stolen-ticket/logout rejection was logged by its negative test, not hidden as a clean server log.

Two intermediate test-recipe failures remain in evidence: using plain Tab after cancelling an editor (which correctly returns to swarm cycling), then expecting an empty doctrine when the real session supplies a default. The recipe was corrected to use the advertised Shift+Tab exit and select the textarea contents before typing; the product fix stayed at two changed lines. Plain Tab intentionally remains swarm cycling on BODY/map, including when a disappearing control leaves BODY focused. In the observed Brave run, two Shift+Tab presses from BODY reached menu.

These are local automated checks, not independent review or exhaustive accessibility/human-use evidence. Existing narrow-screen HUD long-line clipping is outside this correction; map geometry and real pointer orders remain covered. `index.html` is an integration hotspot: the coordinator must recheck the exact composed tree, preserve the disjoint guide work, and arrange independent Luna/Sol gates before any authorized publication/integration. No push, PR, merge or deployment was performed.
