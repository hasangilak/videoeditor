/**
 * waveform — tiny dependency-free audio waveform library.
 *
 * Framework-agnostic: no React, no DOM assumptions beyond a canvas to draw
 * on. Pipeline: Blob → decode (browser built-in) → peak buckets → draw.
 */

/** Max absolute amplitude per bucket across all channels, values in 0..1. */
export function bucketPeaks(channels: Float32Array[], buckets: number): Float32Array {
  const out = new Float32Array(buckets)
  const len = channels[0]?.length ?? 0
  if (!len) return out
  const per = len / buckets
  for (let b = 0; b < buckets; b++) {
    let max = 0
    const end = Math.min(len, Math.max(Math.floor(b * per) + 1, Math.ceil((b + 1) * per)))
    for (let i = Math.floor(b * per); i < end; i++)
      for (const ch of channels) {
        const v = Math.abs(ch[i] ?? 0)
        if (v > max) max = v
      }
    out[b] = max
  }
  return out
}

/**
 * Decode a media file's audio track and reduce it to peak buckets.
 * Bucket count scales with duration (~25/s) unless given, so long files
 * keep detail. Returns null when there is no decodable audio (e.g. a
 * silent video) — that's an expected case, not an error.
 */
export async function extractPeaks(blob: Blob, buckets?: number): Promise<Float32Array | null> {
  try {
    const buf = await blob.arrayBuffer()
    const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf)
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
      audio.getChannelData(i),
    )
    const n = buckets ?? Math.min(20000, Math.max(1000, Math.ceil(audio.duration * 25)))
    return bucketPeaks(channels, n)
  } catch {
    return null
  }
}

/**
 * Paint peaks as a filled envelope mirrored around the vertical center.
 * `from`/`to` are fractions (0..1) of the source to show — pass a clip's
 * trim window so the drawn segment matches what plays. Draw at the
 * canvas's real pixel size; stretching a small canvas blurs.
 */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  opts: { color?: string; from?: number; to?: number } = {},
): void {
  const { color = '#fff', from = 0, to = 1 } = opts
  const ctx = canvas.getContext('2d')
  if (!ctx || !peaks.length) return
  const { width: w, height: h } = canvas
  const lo = Math.max(0, Math.floor(from * peaks.length))
  const hi = Math.min(peaks.length, Math.max(lo + 1, Math.ceil(to * peaks.length)))
  const slice = peaks.subarray(lo, hi)
  const per = slice.length / w

  // one peak per canvas pixel, then a mirrored filled path (crisp at any zoom)
  const col = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    let peak = 0
    const end = Math.min(slice.length, Math.max(Math.floor(x * per) + 1, Math.ceil((x + 1) * per)))
    for (let i = Math.floor(x * per); i < end; i++) peak = Math.max(peak, slice[i] ?? 0)
    col[x] = peak
  }

  const mid = h / 2
  const amp = (p: number) => Math.max(0.5, p * mid) // silence stays a hairline
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, mid - amp(col[0] ?? 0))
  for (let x = 1; x < w; x++) ctx.lineTo(x, mid - amp(col[x] ?? 0))
  for (let x = w - 1; x >= 0; x--) ctx.lineTo(x, mid + amp(col[x] ?? 0))
  ctx.closePath()
  ctx.fill()
}
