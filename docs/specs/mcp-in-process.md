# Spec: MCP tools in the gateway process

Status: accepted by Zacaria, 26 Oct 2026 ("option 1").

## Why

The web gateway (`web-mcp.js`) starts one Node child running `client.js` per OAuth grant. Measured in production: ~35 MB per idle child, so the 1 GB container holds 16 agents (`deploy/mcp-entry.js`). The real per-agent state is a few hundred bytes (`S` in `client.js:59`); everything else is already on the game server. Target: per-agent cost in KB, so the gateway is no longer the capacity limit before the game server (24 matches, `online/live-runtime.js:95`).

## Contract

1. Split `client.js`:
   - New side-effect-free module (e.g. `tools.js`) exporting a factory that takes explicit options `{ server, agentToken?, requireAgentToken?, setup, name?, open?, bypassSecret? }` and returns a fresh `McpServer` bound to its own state `S`. Same 6 tools, same descriptions, schemas and results. It never reads `process.env` or `.env`.
   - `client.js` keeps the CLI: `install`, `.env` loading, local server start, `openUrl`, stdio transport. It calls the factory with values from `process.env`. Local agent behaviour (Claude Code / Codex via `npx … install`) must not change.
   - `live-config.json` is fetched by each factory instance when it is created (not once per process), so a fixed site config reaches new agents without restarting the gateway.
2. `web-mcp.js`: replace the stdio child with `InMemoryTransport.createLinkedPair()` (`@modelcontextprotocol/sdk/inMemory.js`) connecting the existing bridge `Client` to a factory instance. Keep one instance per OAuth grant shared by all its MCP sessions (ChatGPT opens a new session per tool call), the 8-sessions-per-grant cap, refcounted release, idle disposal, revocation checks, tool annotations, error hygiene (never log arguments/results). Unauthenticated (`oauth:false`) sessions keep one instance each.
3. No process is spawned by the gateway. `maxSessions` keeps bounding agents (instances). Raise the production value in `deploy/mcp-entry.js` from a measurement: run N in-process agents doing join_match/wait_for_event against a local game server, record RSS growth per agent, and pick a value that keeps the container well under `mem_limit`. Lower `mem_limit` in `deploy/mcp-compose.yaml` to 512m if the measurement allows (the VM has 1.86 GB, no swap, and the game container needs its 768 MB).
4. `deploy/mcp.Dockerfile`, `package.json` `files`, and any deploy/archive allowlist include the new module.

## Out of scope

Redis/shared state, multiple gateway instances, Rust, game-server capacity, OAuth storage.

## Verification

- `npm test` green (all suites; `test/web-mcp.test.js`, `mcp-oauth`, `mcp-deploy`, `mcp-auth`, `untyped-guidance`, install tests).
- `test/web-mcp.test.js` asserts the gateway spawns zero child processes and that two sessions of one grant share match state.
- Measurement table (agents, RSS) committed in `docs/mcp-oauth.md`.
- Production: after deploy, `/health` OK, container memory read back, and one real ChatGPT game through the "Botters Live" connector.
