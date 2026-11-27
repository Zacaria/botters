import http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const socketPath = process.env.ROUNDS_HOST, side = Number(process.env.ROUNDS_SIDE)
if (!socketPath || !['0', '1'].includes(process.env.ROUNDS_SIDE)) throw new Error('ROUNDS_HOST and ROUNDS_SIDE (0 or 1) required')
const request = (path, body) => new Promise((resolve, reject) => {
  const req = http.request({ socketPath, path, method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {} }, res => {
    let data = ''; res.on('data', c => { data += c }); res.on('end', () => { try { const parsed = JSON.parse(data); if (res.statusCode !== 200) reject(new Error(parsed.error)); else resolve(parsed) } catch (e) { reject(e) } })
  }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined)
})
const { instructions, reference } = await request('/instructions')
const mcp = new McpServer({ name: 'botters', version: '0.2.0' }, { instructions })
const forward = async (path, body) => { const r = await request(path, { side, ...body }); return { content: [{ type: 'text', text: r.text }], ...(r.isError && { isError: true }) } }
mcp.registerTool('wait_for_pause', { description: `Wait for the next planning pause or match end. ${instructions}`, inputSchema: {} }, () => forward('/wait', {}))
mcp.registerTool('set_bot', { description: `Replace your bot during the current pause: a breed and at most yourSlots rules. Omit breed to keep your current one. The last valid submission before the gong plays; a refused or late one does not replace it, and a refusal says what to fix so you can resend. ${reference}`, inputSchema: { round: z.number().int(), breed: z.string().optional(), gambits: z.array(z.object({ if: z.string(), then: z.string(), p: z.number().optional() })), why: z.string() } }, args => forward('/set', args))
await mcp.connect(new StdioServerTransport())
