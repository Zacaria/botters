// Probe only MCP transport/discovery, not a model-played match. OAuth tokens are never printed.
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const endpoint = new URL(process.env.BOTTERS_MCP_URL)
assert.equal(endpoint.protocol, 'https:')
assert.equal(endpoint.pathname, '/mcp')
assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
const expected = ['join_match', 'wait_for_event', 'set_gambits', 'order_swarm', 'split_swarm', 'morph_swarm', 'regroup_swarm', 'set_production', 'release_swarm', 'call_human'].sort()
const health = async () => {
  const response = await fetch(new URL('/health', endpoint), { signal: AbortSignal.timeout(10000) })
  assert.equal(response.status, 200)
  return response.json()
}
const before = await health()
const accessToken = process.env.BOTTERS_MCP_ACCESS_TOKEN
assert.ok(!(accessToken && process.env.BOTTERS_PROBE_PAIR === '1'), 'OAuth is already paired; the pending-pair probe is for the historical no-auth pilot only')
const transport = new StreamableHTTPClientTransport(endpoint, accessToken ? { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } } : undefined)
const client = new Client({ name: 'botters-https-pilot-probe', version: '0.1.0' })
const result = { endpoint: endpoint.href, before, fullMatch: 'not_performed', claudeWeb: 'not_performed', chatgpt: 'not_performed' }
try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map(t => t.name).sort(), expected)
  assert.ok(tools.every(t => t.inputSchema && typeof t.description === 'string'))
  result.tools = tools.map(t => ({ name: t.name, readOnly: t.annotations?.readOnlyHint }))
  result.connected = await health()
  if (process.env.BOTTERS_PROBE_PAIR === '1') {
    // Creates only an unapproved, expiring request. Never approves or starts a game.
    const response = await client.callTool({ name: 'join_match', arguments: {} }, undefined, { timeout: 45000 })
    assert.ok(!response.isError, 'The real game refused the pairing probe')
    const data = JSON.parse(response.content[0].text)
    assert.equal(data.waiting, true)
    const approval = new URL(data.tell_the_human.match(/https:\/\/\S+/)?.[0])
    assert.equal(approval.origin, 'https://botters.havesomecode.io')
    assert.equal(approval.pathname, '/')
    assert.ok(approval.searchParams.has('pair'))
    result.pairing = { waitingForExplicitApproval: true, origin: approval.origin, path: approval.pathname }
  }
} finally {
  try { if (transport.sessionId) await transport.terminateSession() }
  finally { await client.close() }
}
result.after = await health()
console.log(JSON.stringify(result, null, 2))
