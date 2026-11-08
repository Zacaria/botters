// Test-only outbound guard: capture synthetic email without network access.
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.href !== 'https://api.resend.com/emails' || init?.method !== 'POST') throw new Error('Outbound fetch blocked by isolated test')
  const message = JSON.parse(init.body)
  const recipients = Array.isArray(message.to) ? message.to : [message.to]
  if (!recipients.every(to => typeof to === 'string' && to.endsWith('@example.test'))) throw new Error('Synthetic recipients required')
  process.send?.({ type: 'mail', text: message.text, to: recipients[0] })
  return new Response(JSON.stringify({ id: 'synthetic' }), { status: 200, headers: { 'content-type': 'application/json' } })
}
