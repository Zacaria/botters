#!/bin/zsh -l
# Starts a local Botters server, a house opponent, and Codex as your commander. Close this window to stop everything.
cd "${0:A:h}"
[ -d node_modules ] || npm install --silent
trap 'kill 0' EXIT
node server.js > server.log 2>&1 &
( while true; do BOTTERS_NAME=house BOTTERS_DOCTRINE=house.md node client.js --auto; sleep 1; done ) > house.log 2>&1 &
sleep 1
codex -C "$PWD" \
  -c 'mcp_servers.botters.command="node"' -c "mcp_servers.botters.args=[\"$PWD/client.js\"]" \
  -c 'mcp_servers.botters.env={BOTTERS_NAME="zac",BOTTERS_OPEN="Brave Browser"}' \
  -c 'mcp_servers.botters.tool_timeout_sec=60' -c 'mcp_servers.botters.default_tools_approval_mode="approve"' \
  "You are my commander in a Botters match. Call join_match (my browser opens automatically), then keep calling wait_for_event in a loop and react with set_intent, order_units and call_human until the match is over. Messages starting with HUMAN: are from me, obey them. Do not stop before the match ends. Then summarize in 3 lines and ask if I want a rematch."
