// The only shipped public media. Shared by both local servers and the build;
// never derive a filesystem path from an untrusted request outside this list.
import { readFileSync } from 'node:fs'

export const PUBLIC_MEDIA = Object.freeze({
  'media/public-demo.webm': 'video/webm',
  'media/public-demo-poster.jpg': 'image/jpeg',
  'media/public-demo.vtt': 'text/vtt; charset=utf-8',
})

export function servePublicMedia(req, res, pathname) {
  if (!pathname.startsWith('/media/')) return false
  const file = pathname.slice(1)
  if (!['GET', 'HEAD'].includes(req.method) || !Object.hasOwn(PUBLIC_MEDIA, file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return true
  }
  const data = readFileSync(new URL(file, import.meta.url))
  const headers = { 'content-type': PUBLIC_MEDIA[file], 'accept-ranges': 'bytes', 'content-length': data.length, 'x-content-type-options': 'nosniff' }
  let start = 0, end = data.length - 1, status = 200
  if (req.method === 'GET' && req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    const a = match?.[1], b = match?.[2]
    if (a) { start = Number(a); if (b) end = Math.min(Number(b), end) }
    else if (b) start = Math.max(0, data.length - Number(b))
    if (!match || (!a && !b) || (!a && Number(b) === 0) || !Number.isSafeInteger(Number(a || b)) || (b && !Number.isSafeInteger(Number(b))) || start >= data.length || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${data.length}` }); res.end(); return true
    }
    status = 206
    headers['content-range'] = `bytes ${start}-${end}/${data.length}`
    headers['content-length'] = end - start + 1
  }
  res.writeHead(status, headers)
  res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1))
  return true
}
