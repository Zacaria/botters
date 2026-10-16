// Vercel is the website, not a second match authority. The public live-config
// routes new browsers and MCP clients directly to the long-lived service.
export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.statusCode = 410
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: 'Live matches moved to play.botters.havesomecode.io. Reload the website or restart your agent.' }))
}
