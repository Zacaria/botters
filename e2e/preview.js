// Keep Vercel's automation credential scoped to the website, never the live host.
export async function authorizePreview(context) {
  const base = process.env.BOTTERS_SERVER, secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (!base || !new URL(base).hostname.endsWith('.vercel.app') || !secret) return
  const r = await context.request.get(`${base}/?x-vercel-set-bypass-cookie=true`, { headers: { 'x-vercel-protection-bypass': secret } })
  if (r.status() !== 200) throw new Error('Preview authorization failed')
}
export const liveURL = process.env.BOTTERS_LIVE_SERVER || ''
export const state = page => page.evaluate(async () => {
  const config = await fetch('/live-config.json').then(r => r.ok ? r.json() : {})
  return fetch((config.url || '') + '/state?token=' + localStorage.getItem('botters.session')).then(r => r.json())
})
