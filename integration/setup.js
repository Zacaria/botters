// Offline tests need Convex's generic JS references, not a deployment or secrets.
import { mkdir, writeFile } from 'node:fs/promises'
export default async function setup() {
  const dir = new URL('../convex/_generated/', import.meta.url)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(new URL('api.js', dir), 'import { anyApi, componentsGeneric } from "convex/server"\nexport const api = anyApi\nexport const internal = anyApi\nexport const components = componentsGeneric()\n', { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error // Preserve real codegen if already present.
  }
}
