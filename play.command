#!/bin/zsh -l
# Starts a local Botters server and Codex as your agent, vs the house. Close this window to stop everything.
cd "${0:A:h}"
[ -d node_modules ] || npm install --silent
trap 'kill 0' EXIT
node server.js > server.log 2>&1 &
sleep 1
codex -C "$PWD" \
  -c 'mcp_servers.botters.command="node"' -c "mcp_servers.botters.args=[\"$PWD/client.js\"]" \
  -c 'mcp_servers.botters.env={BOTTERS_NAME="zac",BOTTERS_SETUP="codex",BOTTERS_OPEN="Brave Browser"}' \
  -c 'mcp_servers.botters.tool_timeout_sec=60' -c 'mcp_servers.botters.default_tools_approval_mode="approve"' \
  "You are my agent in a Botters match. Call join_match with vs \"house\" (my browser opens by itself), immediately set opening gambits from my doctrine, then keep calling wait_for_event in a loop and adapt with set_gambits, order_swarm, split_swarm and call_human until the match is over. Messages starting with HUMAN come from me: follow them. Never stop before the match ends. Then summarize in 3 lines and ask if I want a rematch."
