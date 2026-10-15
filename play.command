#!/bin/zsh -l
# Starts a local Botters server and Codex as your agent. Your lobby opens in the browser. Close this window to stop everything.
cd "${0:A:h}"
[ -d node_modules ] || npm install --silent
trap 'kill 0' EXIT
node server.js > server.log 2>&1 &
sleep 1
codex -C "$PWD" \
  -c 'mcp_servers.botters.command="node"' -c "mcp_servers.botters.args=[\"$PWD/client.js\"]" \
  -c 'mcp_servers.botters.env={BOTTERS_NAME="zac",BOTTERS_SETUP="codex",BOTTERS_OPEN="Brave Browser"}' \
  -c 'mcp_servers.botters.tool_timeout_sec=60' -c 'mcp_servers.botters.default_tools_approval_mode="approve"' \
  "Let's play Botters. Call join_match and follow what it says: it waits until I press Play in my lobby. In a match, keep calling wait_for_event and adapt with set_gambits, order_swarm, split_swarm and call_human until it ends. Events starting with HUMAN come from me: follow them, and keep rules I switched off, off. After each match, give me the result in 3 lines, then call join_match again. Keep playing match after match until I tell you to stop."
