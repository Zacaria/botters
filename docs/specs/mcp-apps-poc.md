# MCP Apps POC: the live match map inside Claude and ChatGPT

Status: proof of concept, 23 November 2026.

## What it does

The MCP server (local `client.js` and remote `/mcp`, both built by `createBottersTools` in `tools.js`) exposes:

- a resource `ui://botters/match`, mime `text/html;profile=mcp-app` (MCP Apps, extension `io.modelcontextprotocol/ui`, spec 2026-01-26). The HTML is built by `match-view.js`: one self-contained page, inline script and style, no external origin. Its CSP metadata declares empty `connectDomains` and `resourceDomains`.
- a read-only tool `show_match` whose `_meta.ui.resourceUri` points to that resource (plus `openai/outputTemplate` for ChatGPT). It returns a one-line text summary for the model and, in `structuredContent`, a compact fogged frame: clock, totals, your battalions, enemies in sight, planets. It reads the same agent `/state` as `get_state`, so the fog and authorization are the server's.
- `start_match` starts and joins a house match from a chat request, opening the same live map.
- app-only `match_frame` supplies light refreshes, omitting known planet geometry.
- `join_match` tells loop-running agents to call `show_match` once.

The view draws the map on a canvas with the game page's colours, interpolating positions between frames. It refreshes through the host bridge with `match_frame`, falling back to `show_match` if refused, about once per second, until the match ends or 30 minutes pass; while waiting for a match it polls every three seconds. It needs no network access and no token in the iframe: the host proxies the call to the MCP server with the user's existing connection.

Hosts that do not render MCP Apps just get the text summary; the other tools and the browser game are unchanged.

## Verified

- `test/mcp-app.test.js`: tool metadata, resource mime/CSP, inline script parses, idle message before a match, live frame after `join_match` over the real stdio client against an isolated local server.
- The reference host `basic-host` from `modelcontextprotocol/ext-apps` (sandboxed iframe on a second origin, CSP from metadata): the map renders inline and follows the match (clock and battalions move) through repeated `tools/call` from the view.
- Production, 23 November 2026: `basic-host` connected to `https://play.botters.havesomecode.io/mcp` with a real OAuth grant (QA account) lists `show_match` and `ui://botters/match`, and the map follows a live house match at 1280 and 390 px.

## Not verified in Claude or ChatGPT yet

claude.ai and chatgpt.com answer a Cloudflare human check to the automated browser available to agents, and the owner's Claude account has no Botters connector yet. The in-chat render needs a person: add Botters from the guide ("Add to Claude"), start a match with an agent, then ask the assistant to show the map.

## One request: start, join, watch (26 November 2026)

Owner (26/11): « Pour jouer dans claude ou chatgpt j'imagine juste appeler une commande et ça m'ouvre l'interface de botters intégrée au chat. Du coup on peut automatiser la connexion avec l'agent vu qu'on est déjà intégrés, et on n'a plus qu'à suivre la partie et discuter avec l'agent en même temps. »

### Journey

1. The human writes « lance une partie Botters » (or any equivalent). The model calls `start_match` (`level` easy/normal/hard, default normal; `minutes` 3/5/8, default 3).
2. `start_match` starts a house match **with the agent** on the human's account (`POST /play`, agent token, house levels only) and joins it in the same call (`GET /next`). The connector's OAuth grant is the approval: no second pairing, no visit to the site. If a match is already running, it joins that one.
3. The tool carries `_meta.ui.resourceUri`, so the host opens the map card with the first frame right away. Planning lasts 30 seconds: the model writes the opening gambits from the human's doctrine with `set_gambits`, answers in a line or two, and ends its turn.
4. The card follows the match to the result through the app-only `match_frame` tool (below).
5. The human talks to the agent in the conversation. On each message the model reads `get_state` and rewrites the gambits (`set_gambits`, `toggle_gambit`).

The card gives no orders. Hand orders stay with the human on the site; the agent role keeps its refusal: "Hand orders are for your human. Ask with call_human."

`join_match` remains available for agents that run their own loop (Claude Code, Codex): the human starts the match in the lobby, the agent waits for events. Its description directs chat requests to `start_match`.

### Server rule

The `agent` role may now call `POST /play`, limited to house levels and always with the agent (`withAgent` forced on). Everything else stays refused (matches against players, rooms, account, doctrine, hand orders). The consent page says so.

### Light refresh

The view polls `match_frame` about once per second instead of `show_match`. It is app-only (`_meta.ui.visibility: ["app"]`): hosts list it to the view, not to the model, so the refresh never enters the conversation. Given the `matchId` it already holds, it omits planet geometry (position, radius) and returns only owner and capture. The remote gateway answers these calls outside its request queue, so an agent long poll (`wait_for_event`) never stalls the map. A host that refuses app-only tools falls back to `show_match`.

### Limit: the agent acts only when the human writes

A chat model runs only during its turn. Between two messages from the human nobody rewrites the gambits: the battalions keep following the last ones written, and the house keeps playing. Events (enemy spotted, planet lost) wait in the event log until the next turn.

Proposal, not built: on a key event (planet lost, big enemy army spotted, last 30 seconds), the card could post `ui/message` to the host with a short prompt such as "Planet 4 lost. Adapt the gambits?", which wakes the model for one turn. Hosts may ask the human to confirm or ignore it, and it spends model turns; it needs a rate limit (one per event kind, at most one every 20 seconds) and an off switch on the card.

## Host differences and limits

- Refresh depends on `hostCapabilities.serverTools`. Without it, the view shows the snapshot from the tool result only. A live socket to the match room was not used: it would need the agent token inside the iframe and a CSP `connectDomains` entry.
- Refresh is one MCP call per second while a match is visible, app-only and without planet geometry when supported; fallback uses `show_match`.
- The view is read-only by design. Hand orders stay on the website.
- Inline mode uses a dark color scheme and hides overflow to avoid light scrollbars; fullscreen permits scrolling and fits the canvas to the viewport.
- Battalion numbers get small on a 390 px frame (the canvas scales the 1200 × 700 map); fullscreen helps where the host offers it.
