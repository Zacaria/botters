# MCP Apps POC: the live match map inside Claude and ChatGPT

Status: proof of concept, 23 November 2026.

## What it does

The MCP server (local `client.js` and remote `/mcp`, both built by `createBottersTools` in `tools.js`) exposes:

- a resource `ui://botters/match`, mime `text/html;profile=mcp-app` (MCP Apps, extension `io.modelcontextprotocol/ui`, spec 2026-01-26). The HTML is built by `match-view.js`: one self-contained page, inline script and style, no external origin. Its CSP metadata declares empty `connectDomains` and `resourceDomains`.
- a read-only tool `show_match` whose `_meta.ui.resourceUri` points to that resource (plus `openai/outputTemplate` for ChatGPT). It returns a one-line text summary for the model and, in `structuredContent`, a compact fogged frame: clock, totals, your battalions, enemies in sight, planets. It reads the same agent `/state` as `get_state`, so the fog and authorization are the server's.
- `join_match` now tells the agent to call `show_match` once.

The view draws the map on a canvas with the game page's colours, interpolating positions between frames. It refreshes by calling `show_match` again through the host bridge (`tools/call` from the iframe), about once per second, until the match ends or 30 minutes pass. It needs no network access and no token in the iframe: the host proxies the call to the MCP server with the user's existing connection.

Hosts that do not render MCP Apps just get the text summary; the other tools and the browser game are unchanged.

## Verified

- `test/mcp-app.test.js`: tool metadata, resource mime/CSP, inline script parses, idle message before a match, live frame after `join_match` over the real stdio client against an isolated local server.
- The reference host `basic-host` from `modelcontextprotocol/ext-apps` (sandboxed iframe on a second origin, CSP from metadata): the map renders inline and follows the match (clock and battalions move) through repeated `tools/call` from the view.

## Host differences and limits

- Refresh depends on `hostCapabilities.serverTools`. Without it, the view shows the snapshot from the tool result only. A live socket to the match room was not used: it would need the agent token inside the iframe and a CSP `connectDomains` entry.
- Every refresh is a full MCP tool call (about 1 per second while the view is open). Acceptable for a POC; a real version would want a lighter frame or app-only visibility (`_meta.ui.visibility: ["app"]`) on a dedicated refresh tool.
- The view is read-only by design. Hand orders stay on the website.
- Real-host results (Claude, ChatGPT) are recorded on the Kanban card for this POC.
