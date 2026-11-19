# Remote MCP

The connector is `https://play.botters.havesomecode.io/mcp`. Clients use OAuth authorization code flow with S256 PKCE. Sign in and explicitly approve agent access in Botters. Grants can be revoked; agents receive no human account cookie or human capability. The connector does not start matches.

The Worker stores authorization and token state in D1 and routes agent sessions through Durable Objects. Keep secrets and tokens out of logs and fixtures. Local tests use isolated resources.
