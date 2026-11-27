// The asset binding answers neither byte ranges nor a length. The length is counted once per isolate; bodies are streamed, never held.
const sizes = new Map()
export async function rangeResponse(request, fetchAsset) {
  const key = new URL(request.url).pathname
  let response = await fetchAsset()
  if (response.status !== 200) return response
  let length = Number(response.headers.get('content-length')) || sizes.get(key)
  if (!length) {
    length = 0
    for (const reader = response.body.getReader();;) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength }
    sizes.set(key, length)
    response = await fetchAsset()
    if (response.status !== 200) return response
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range'))
  const a = match?.[1], b = match?.[2]
  const start = a ? Number(a) : Math.max(0, length - Number(b)), end = a && b ? Math.min(Number(b), length - 1) : length - 1
  if (!match || (!a && !b) || (!a && Number(b) === 0) || (a && !Number.isSafeInteger(Number(a))) || (b && !Number.isSafeInteger(Number(b))) || start >= length || start > end) {
    await response.body?.cancel()
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${length}` } })
  }
  const reader = response.body.getReader(); let skip = start, left = end - start + 1
  const body = new ReadableStream({
    async pull(controller) {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return controller.close()
        if (skip >= value.byteLength) { skip -= value.byteLength; continue }
        const part = value.subarray(skip, skip + left); skip = 0; left -= part.byteLength
        controller.enqueue(part)
        if (!left) { controller.close(); await reader.cancel() }
        return
      }
    },
    cancel: reason => reader.cancel(reason)
  })
  const headers = new Headers(response.headers)
  headers.set('content-range', `bytes ${start}-${end}/${length}`)
  headers.set('content-length', String(end - start + 1))
  headers.set('accept-ranges', 'bytes')
  return new Response(globalThis.FixedLengthStream ? body.pipeThrough(new FixedLengthStream(end - start + 1)) : body, { status: 206, headers })
}
