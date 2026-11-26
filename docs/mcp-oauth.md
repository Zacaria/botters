# Remote MCP

The connector is `https://play.botters.havesomecode.io/mcp`. Clients use OAuth authorization code flow with S256 PKCE. Sign in and explicitly approve agent access in Botters. Grants can be revoked; agents receive no human account cookie or human capability. The connector can start house matches with the agent only.

The Worker stores authorization and token state in D1 and routes agent sessions through Durable Objects. One Durable Object per grant holds the match state shared by all its MCP sessions. It keeps at most 8 sessions: opening a ninth closes the least recently used one (ChatGPT opens a session per call and never closes it), and sessions idle for 10 minutes end. A closed session answers 404 "Session ended"; the client initializes again without losing match state. Keep secrets and tokens out of logs and fixtures. Local tests use isolated resources.
