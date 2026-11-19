// Build once before local fixtures start; hosted verification builds nothing.
export default async function setup() {
  await import('../scripts/build.js')
  await import('../scripts/build-cloudflare.js')
}
