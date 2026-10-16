# Installer candidate verification

Task: `t_d0bc2c37`. Branch: `install-autodetect`. Base: `8840ddb9b77557c430abea27c9a22d312646e8c5`. Tested on Linux, Node 24.21.0, Claude Code 2.1.285 and Codex 0.159.0. Exact implementation and test hashes are in `install-verification.json`; the signed candidate commit is recorded in the Kanban review handoff.

## Results

| Command | Result |
| --- | --- |
| `npm ci` | PASS; lockfile reproduced |
| `npm audit` | PASS; zero reported vulnerabilities |
| `npm test` | PASS; 78 tests, including nine installer tests |
| `npm run check` | PASS; 71 JavaScript files, inline browser scripts and JSON |
| `npm run build` | PASS; public assets and bundled live client built |
| `npm run test:auth:convex` | PASS; four tests across three files, isolated actual component |
| `npm run test:auth:browser` | PASS; three tests, loopback with captured mail |
| `npm run test:browser` | PASS; nine tests in Brave, including the installer guide with/without JavaScript and its copy button |
| `node scripts/verify-install.js` | PASS; real client CLIs, fresh temporary HOME with spaces, packed npx entrypoint, online MCP tools/list, no-op rerun, offline update, uninstall and repeated uninstall |
| `npx -y -p node@22 node --test test/install.test.js` | PASS; nine tests on the minimum supported Node major |
| `git diff --check` | PASS |

The first installer test run failed because `install.js` did not exist. Additional malformed-config tests failed before duplicate-key rejection was added. The real-CLI check reproduced Codex's requirement that a custom `CODEX_HOME` directory already exist; the installer now creates config directories after confirmation and before invoking the CLI.

All five client types have temporary-HOME fixtures for macOS, Linux and Windows paths. Fixtures verify preservation of unrelated settings/servers, JSON comments, restricted backup permissions, interactive refusal/acceptance, noninteractive refusal, CLI user scope, malformed-config preflight, symlink refusal, concurrent changes, CLI failure restoration, online/offline updates and idempotent removal. GUI clients and native macOS/Windows execution were not available on this Linux host.

The actual configured Claude and Codex stdio commands, plus the packed candidate entrypoint, each returned the same seven tools: `call_human`, `join_match`, `order_swarm`, `release_swarm`, `set_gambits`, `split_swarm`, `wait_for_event`. No tool was invoked beyond tools/list. No human login, pairing, match creation, inference request or live account/database write was performed.

## Environment preparation and warnings

- A fresh worktree lacks ignored `convex/_generated` helpers, so the initial optional component test failed. `npx convex codegen --typecheck disable` required a configured deployment. Instead, the existing generated helpers were copied read-only from the `pvp` worktree after `git diff --exit-code 8840ddb9b77557c430abea27c9a22d312646e8c5 -- convex` proved its Convex source identical to this base. The final component suite passed. Only ignored generated files were populated; no account or Convex source was edited and no deployment was configured or contacted.
- npm reports existing allowScripts-policy warnings for the two esbuild versions and msgpackr-extract. No policy was relaxed; the actual build and all test suites passed.
- Codex warns about missing custom HOME helpers before its directory exists, and refuses PATH-helper creation under the temporary directory. MCP registration and readback succeed. Codex's JSON readback omits approval policy; `default_tools_approval_mode="approve"` is verified in its actual TOML, while startup/tool timeouts are verified through both TOML and CLI JSON.
- No separate formatter, linter or typecheck command is configured. `npm run check` is the repository's canonical syntax/config check.
- JSON/JSONC comments and unrelated values are retained. TOML values and servers are retained but TOML comments/formatting may change. Existing Botters customizations are replaced by the selected mode, with a restricted backup first. Installation is per-client: an earlier successful target remains configured if a later target fails; output identifies completed targets and restores the failed target.

## Scope and release

The diff contains the installer, its early CLI dispatch and package dependencies, guide/README changes, fixtures, browser checks, acceptance script and these documents. No source files were deleted; the old prominent per-client setup instructions were replaced with one command and retained only in the collapsed manual fallback. Temporary test HOMEs and package archives are removed by the verification script. Build outputs, dependencies and logs remain ignored for active review.

Independent review comes next. Do not publish the new guide as an available setup flow yet: the repository's remote default ref is still `master` at `42e711776b516b35fde2301544f7ee3b398b88d7`, which has no installer. After approval, integrate the exact reviewed source into `pvp-online`; the release owner must also make that reviewed installer reachable from the default GitHub ref before promoting the guide. Any default-branch change or merge into `master` needs its own applicable release authority. Run the literal `npx -y github:Zacaria/botters install --yes` in a new HOME after that ref is updated, then publish and read back the guide. The packed candidate is verified; the unqualified public GitHub command is not claimed as released.
