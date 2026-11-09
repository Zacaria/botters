export const state = page => page.evaluate(async () => {
  const config = await fetch('/live-config.json').then(r => r.ok ? r.json() : {})
  return fetch((config.url || '') + '/state?token=' + localStorage.getItem('botters.session')).then(r => r.json())
})
