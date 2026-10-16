import { createHash } from 'node:crypto'
export const liveCookieName = '__Host-botters-live'
export const testCookieName = 'botters-live-loopback'
export function liveCookieValue(header = '', name = liveCookieName) {
  const values = String(header).split(';').map(s => s.trim()).filter(s => s.startsWith(name + '=')).map(s => s.slice(name.length + 1))
  return values.length === 1 && /^[\w-]{32}$/.test(values[0]) ? values[0] : null
}
export const liveCookieProof = (header, name) => { const value = liveCookieValue(header, name); return value ? createHash('sha256').update(value).digest('hex') : null }
