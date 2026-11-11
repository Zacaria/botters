# Botters

A real-time space strategy game played with an AI agent through MCP. Node.js 22+; npm; ES modules. Online accounts and matches coexist with login-free local house games.

## Layout

`server.js`, `client.js`, and `tools.js` provide the local server and MCP client/tools; `index.html` and `guide.html` are the browser UI. `sim.js` runs the simulation and `sim/` contains the Rust map generator and included WebAssembly package. `api/`, `online/`, and `convex/` implement hosted play, identity and persistence; `web-mcp.js` and `mcp-oauth.js` support remote MCP. Tests live in `test/`, `e2e/`, and `integration/`; operational contracts are in `docs/`.

## Development and checks

- `npm install` installs dependencies; `npm run server` starts local development on port 8787.
- `npm test` runs Node tests; `npm run check` checks JavaScript, inline scripts and JSON; `npm run build` writes public assets.
- `npm run test:browser`, `npm run test:auth:browser`, and `npm run test:auth:convex` cover browser and isolated auth paths. Consult the README for prerequisites and scope; `npm run test:online` targets a real configured server.
- After Rust changes, `npm run build:sim` requires the wasm32 target and wasm-bindgen CLI 0.2.100.

## Boundaries and conventions

Preserve the separation between human account sessions, human capabilities and explicitly approved, revocable agent grants. Do not expose credentials, account data, cookies or provider keys to clients, logs or fixtures. Keep local tests isolated from production identity and data; preview authentication has its own constraints in `docs/auth.md`. Publishing, provider configuration, live tests and deployment require the relevant explicit scope; historical release reports are evidence, not blanket authorization. The installer edits agent configuration, so inspect its effect and obtain appropriate permission before running it.

## Shared building rules

Read the shared file below before changing this project. Its development rules apply only if the project has no real users yet; confirm that status before applying them. Existing project-specific security, data-preservation, and release requirements still apply.

@/home/hermes/repos/prompts-lib/AGENTS_BUILDING.md

Record project-specific corrections in this project's `## Lessons` section, not in the shared file.

## Lessons

Record project-specific lessons here as they are established.
