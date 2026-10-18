import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'

// Break caught: replacing the announcement with silent raw footage or a wrong
// export preset. Probe actual shipped bytes, never a sidecar's claimed values.
// ffmpeg is a production/review tool, not a new runtime dependency: CI runners
// without it report an explicit skip; the media acceptance lane must execute it.
const available = spawnSync('ffprobe', ['-version']).status === 0

test('announcement trailer has a real music stream and a one-minute 1080p picture', { skip: !available && 'ffprobe unavailable; media acceptance still required' }, () => {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', 'media/public-demo.webm'], { encoding: 'utf8' }))
  const video = probe.streams.find(s => s.codec_type === 'video')
  const audio = probe.streams.find(s => s.codec_type === 'audio')
  assert.ok(audio, 'announcement must contain a real music stream, not silent capture')
  assert.ok(audio.channels >= 1)
  assert.equal(video.width, 1920)
  assert.equal(video.height, 1080)
  assert.ok(Number(probe.format.duration) >= 55 && Number(probe.format.duration) <= 65, 'roughly one-minute edited film')
})

// Break caught: muxing silence, clipping the score, or losing the two-second
// contrast before manual intervention. Decode actual audio samples, not tags.
test('trailer music decodes with headroom and a deliberate pre-intervention breath', { skip: !available && 'ffmpeg unavailable; decoded-media acceptance required' }, () => {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', 'media/public-demo.webm', '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 8 * 1024 * 1024 })
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4)
  const rms = (a, b) => {
    let sum = 0
    for (let i = a * 8000; i < b * 8000; i++) sum += samples[i] ** 2
    return Math.sqrt(sum / ((b - a) * 8000))
  }
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  assert.ok(samples.length >= 59 * 8000, 'full-length decoded music')
  assert.ok(peak > 0.1 && peak < 0.95, `non-silent music with headroom: peak ${peak}`)
  assert.ok(rms(31, 33) < (rms(29, 31) + rms(33, 35)) / 4, 'musical breath at31–33s must be lower than adjacent action')
})

// SOL-FILM-01: a too-wide/low final crop puts planet7 under the caption.
// Probe the exposed lower disk interior in the actual 308px picture before
// and after capture, not the subtitle, manifest, capture arc or bright swarm.
// This fixed-shot regression complements (does not replace) rendered review.
test('final ownership fill changes visibly above captions at phone player size', { skip: !available && 'ffmpeg unavailable; rendered-media acceptance required' }, () => {
  const region = seconds => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', 'media/public-demo.webm', '-frames:v', '1', '-vf', 'scale=308:174,crop=24:18:142:55,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1024 * 1024 })
  const before = region(50), after = region(51.5)
  let neutral = 0, filled = 0, redGain = 0
  for (let i = 0; i < before.length; i += 3) {
    const [r, g, b] = before.subarray(i, i + 3)
    if (Math.abs(r - g) < 7 && Math.abs(g - b) < 7 && r < 65) neutral++
    const [ar, ag, ab] = after.subarray(i, i + 3)
    if (ar > ag * 1.8 && ab > ag * 1.3 && ar > ab + 5 && ar < 160) filled++
    redGain += ar - r
  }
  const n = before.length / 3
  assert.ok(neutral / n > 0.6, `before: unobstructed neutral disk, not pink swarm/caption (${neutral}/${n})`)
  assert.ok(filled / n > 0.7, `after: exposed pink disk, not caption (${filled}/${n})`)
  assert.ok(redGain / n > 12, `visible native ownership fill change (${redGain / n} red levels)`)
})

// Break caught: burned captions placed underneath small native video controls.
// A real390px embedded screenshot exposed the failure. Require the main white
// story text in the safe band above that player overlay, not only in a VTT.
test('burned story captions stay above small native player controls', { skip: !available && 'ffmpeg unavailable; rendered-media acceptance required' }, () => {
  for (const seconds of [18, 39, 47.8]) {
    const pixels = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', 'media/public-demo.webm', '-frames:v', '1', '-vf', 'crop=1320:200:300:490,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1024 * 1024 })
    let white = 0
    for (const pixel of pixels) if (pixel >= 235) white++
    assert.ok(white / pixels.length > 0.015, `burned caption at${seconds}s must be above the measured native control overlay`)
  }
})
