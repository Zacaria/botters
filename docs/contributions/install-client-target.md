# Install only the selected client

## Bound decision and acceptance (written before implementation)

Base: `0f67b358b05a3e4682f2cb980ab8db53c2e7302b` (PR5 integrated), tree `dcadbe98602624ab673b0ed7c6b43368ed3e9f8c`.
Scope: `botters.install-single-client`, task `t_e7c345a3`, native Hermes.

Add only `botters install --client <id>` for one exact existing ID: `claude`, `codex`, `desktop`, `cursor`, `windsurf`. No aliases, repeated selector, equals syntax, menu, new registry or dependency. With no selector, detection and global preflight remain unchanged.

Acceptance:

- Filter the existing locations before any excluded snapshot, parse or CLI lookup. With all five clients present, only the selected config, its backups and CLI may change; plan/logs list only that target.
- Codex selection succeeds with malformed or symlinked Cursor, while the same fixture without selection still fails before writes. Selected malformed/symlinked configs remain errors.
- All five IDs retain existing detection, custom HOME/config paths and darwin/linux/win32 path rules. A missing selected client errors without fallback or config creation.
- Missing/unknown/repeated client and unknown options fail with useful usage and IDs before config/CLI operations. The programmatic planner also rejects unknown clients.
- Preserve confirmation, noninteractive refusal without `--yes`, help, online default, selected `--local` and selected `--uninstall`.
- Preserve unrelated settings/servers, private backups, config modes, concurrent-change checks, CLI-failure restoration and idempotence. Exercise selected install → rerun → local update → uninstall → rerun, including no excluded bytes/directories/backups/CLI calls.

## Implementation boundary

Reuse `clientLocations`, `planInstall` and `applyPlan`; do not alter write/rollback protections. Only `install.js`, `test/install.test.js`, `docs/install.md` and this note may change. Do not change the accepted public guide, result sharing, runtime, auth, providers or dependencies.

## Verification protocol

First retain actual RED output for the Codex-valid/Cursor-malformed CLI and planner tests on the unchanged installer. Then run selected tests, the complete installer suite, `npm run check`, `npm run build`, `npm test` under the shared browser fixture lock, and `git diff --check`. Installer fixtures inject HOME/env/lookup/run and live exclusively below TMPDIR. No real client command, config, network installer or `scripts/verify-install.js` execution. Shared locked dependencies are read-only. Browser tests exercise only repository-local fixtures, not authenticated production clients.

The signed local candidate and recoverable bundle, exact base/commit/tree, executed logs and native session identity belong in the task evidence directory. Publication, independent reviews and integration remain the coordinator's responsibility; this local implementation is not a release or a human usability verdict.

## Executed producer checks

Native session `20261019_054013_a2ce9e`, Kanban run `949`, profile `contrib-hermes`, model `gpt-6.1-sol` / provider `openai-codex`. No method framework or subagent was loaded.

- RED on the unchanged installer: both discriminating tests failed. CLI returned `1` with `Unknown install option`; direct planner threw `Cursor: Invalid JSON/JSONC`. Retained in `red-selected.log`.
- GREEN: 22 selected-client tests passed. Complete installer suite: 31 passed, 0 failed/skipped, including the unchanged global-preflight tests. The 15 client/platform combinations exercise path selection on Linux, not execution on macOS or Windows.
- `npm run check`: syntax checked 78 JS files, inline scripts and JSON. No separate lint/type/format tool is configured.
- `npm run build`: built 8 public assets and the existing browser bundle/config.
- `npm test`: 110 passed, 0 failed/skipped, including the installer tests and real local browser/MCP fixtures. Counts overlap; do not add the focused suites to 110. Shared browser-fixture lock acquired after 0.000003 seconds and released on command exit.
- `git diff --check`: passed.

The final check sequence ran from 2026-10-19T05:44:33Z through 05:45:28Z. `evidence/verify.sh` records the exact commands and clean environment. Its short `TMPDIR=/proc/self/cwd/.cache/t` resolves into this task's ignored checkout cache, avoiding Chromium Unix-socket path limits; HOME, npm cache and browser cache are also task-local. Installer lookup/run are injected test doubles, not real client installation or model execution. Shared approved dependencies were used read-only, without installation or package/lock changes. No live account, provider, remote backend, global profile, public push, PR, merge or deployment was exercised. Independent source/rendered reviews remain pending with the coordinator.
