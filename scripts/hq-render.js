// Capture-only: draw the game canvas at S× resolution so enlarged trailer crops stay sharp.
// Same simulation and drawing code; only the canvas backing store and particle blocks scale.
export const S = 3
const swap = (h, a, b) => { if (!h.includes(a)) throw new Error('index.html changed, update hq-render: ' + a.slice(0, 40)); return h.replace(a, b) }
export function hq(html) {
  html = swap(html, 'cv.width = W; cv.height = H;', `cv.width = W * ${S}; cv.height = H * ${S};`)
  html = swap(html, 'img = g.createImageData(W, H);', `img = g.createImageData(W * ${S}, H * ${S});`)
  html = swap(html, 'const x = (at.x + Math.cos(a) * r) | 0, y = (at.y + Math.sin(a) * r * 0.85) | 0',
    `const x = ((at.x + Math.cos(a) * r) * ${S}) | 0, y = ((at.y + Math.sin(a) * r * 0.85) * ${S}) | 0`)
  html = swap(html, 'if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c.fighting && (j & 3) === 0 && Math.random() < 0.5 ? WHITE : col',
    `if (x >= 0 && x < W * ${S} - ${S} && y >= 0 && y < H * ${S} - ${S}) { const q = c.fighting && (j & 3) === 0 && Math.random() < 0.5 ? WHITE : col; for (let dy = 0; dy < ${S}; dy++) for (let dx = 0; dx < ${S}; dx++) px[(y + dy) * W * ${S} + x + dx] = q }`)
  return swap(html, 'g.putImageData(img, 0, 0)', `g.putImageData(img, 0, 0); g.setTransform(${S}, 0, 0, ${S}, 0, 0)`)
}
