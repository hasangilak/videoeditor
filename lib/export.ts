'use client'
import { Muxer, ArrayBufferTarget } from 'webm-muxer'
import { useEditor, dispatch, docDuration, activeClips, type Doc, type Media } from './store'

const W = 1280
const H = 720
const FPS = 30
const SR = 48000 // opus is a 48 kHz codec

// Offline export via WebCodecs: frames are rendered one by one (every seek is
// awaited, so nothing is dropped while a decoder warms up), audio is mixed with
// OfflineAudioContext, and both are muxed into a .webm. Runs faster than
// realtime and doesn't need the tab visible. Browsers without WebCodecs fall
// back to recording the preview canvas in realtime (video only).
//
// With a clip selected, only that clip's slice of the timeline is exported;
// otherwise the whole timeline is.
export function exportTimeline(canvas: HTMLCanvasElement): Promise<void> {
  const s = useEditor.getState()
  if (docDuration(s.doc) === 0 || s.session.playing) return Promise.resolve()
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined')
    return exportRealtime(canvas)
  const sel = s.session.selection ? s.doc.clips[s.session.selection] : null
  const range = sel
    ? { from: sel.start, to: sel.start + (sel.out - sel.in) }
    : { from: 0, to: docDuration(s.doc) }
  return exportOffline(s.doc, s.media, range)
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((res, rej) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = url
    v.onerror = () => rej(new Error('export: video failed to load'))
    // poll readyState instead of trusting loadeddata: a wedged browser media
    // pipeline can leave elements loading forever — fail fast, don't hang
    const t0 = performance.now()
    const poll = () => {
      if (v.readyState >= 2) return res(v)
      if (performance.now() - t0 > 10_000)
        return rej(new Error('export: video decoder never became ready — reload the tab or restart the browser'))
      setTimeout(poll, 100)
    }
    poll()
  })
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  const want = Math.min(Math.max(t, 0), Math.max(v.duration - 0.001, 0))
  if (!v.seeking && Math.abs(v.currentTime - want) < 1 / (FPS * 4)) return Promise.resolve()
  return new Promise((res) => {
    const done = () => {
      v.removeEventListener('seeked', done)
      clearTimeout(guard)
      res()
    }
    // sub-frame nudges can skip the seeked event — never hang the export on one
    const guard = setTimeout(done, 2000)
    v.addEventListener('seeked', done)
    v.currentTime = want
  })
}

type Range = { from: number; to: number }

/** Every clip's audio placed at its timeline position, mixed to one stereo buffer. */
async function mixAudio(
  doc: Doc,
  media: Record<string, Media>,
  range: Range,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil((range.to - range.from) * SR), SR)
  const decoded = new Map<string, AudioBuffer | null>()
  for (const clip of Object.values(doc.clips)) {
    const clipEnd = clip.start + (clip.out - clip.in)
    if (clipEnd <= range.from || clip.start >= range.to) continue
    const m = media[clip.mediaId]
    if (!m) continue
    if (!decoded.has(m.id)) {
      try {
        const bytes = await (await fetch(m.url)).arrayBuffer()
        decoded.set(m.id, await ctx.decodeAudioData(bytes))
      } catch {
        decoded.set(m.id, null) // no audio track — the clip contributes silence
      }
    }
    const buf = decoded.get(m.id)
    if (!buf) continue
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    // trim the clip to the exported window and shift it to the window's clock
    const skip = Math.max(range.from - clip.start, 0)
    src.start(
      Math.max(clip.start - range.from, 0),
      clip.in + skip,
      Math.min(clipEnd, range.to) - Math.max(clip.start, range.from),
    )
  }
  return ctx.startRendering()
}

function encodeAudio(mixed: AudioBuffer, encoder: AudioEncoder) {
  const chunk = 960 // one 20 ms opus packet at 48 kHz
  const left = mixed.getChannelData(0)
  const right = mixed.getChannelData(1)
  for (let off = 0; off < mixed.length; off += chunk) {
    const n = Math.min(chunk, mixed.length - off)
    const data = new Float32Array(n * 2)
    data.set(left.subarray(off, off + n), 0)
    data.set(right.subarray(off, off + n), n)
    encoder.encode(
      new AudioData({
        format: 'f32-planar',
        sampleRate: SR,
        numberOfChannels: 2,
        numberOfFrames: n,
        timestamp: (off / SR) * 1e6,
        data,
      }),
    )
  }
}

async function exportOffline(doc: Doc, media: Record<string, Media>, range: Range): Promise<void> {
  const duration = range.to - range.from

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'V_VP8', width: W, height: H, frameRate: FPS },
    audio: { codec: 'A_OPUS', sampleRate: SR, numberOfChannels: 2 },
  })

  let failure: unknown = null
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure ??= e),
  })
  videoEncoder.configure({ codec: 'vp8', width: W, height: H, bitrate: 6_000_000, framerate: FPS })
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => (failure ??= e),
  })
  audioEncoder.configure({ codec: 'opus', sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 })

  // export renders on its own canvas with its own decoders so the preview's
  // draw loop can't fight it over currentTime
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  const videos = new Map<string, HTMLVideoElement>()
  try {
    encodeAudio(await mixAudio(doc, media, range), audioEncoder)

    for (const clip of Object.values(doc.clips)) {
      if (clip.start + (clip.out - clip.in) <= range.from || clip.start >= range.to) continue
      const m = media[clip.mediaId]
      if (m && !videos.has(m.id)) videos.set(m.id, await loadVideo(m.url))
    }

    const frames = Math.ceil(duration * FPS)
    for (let i = 0; i < frames; i++) {
      if (failure) throw failure
      const t = range.from + i / FPS
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      for (const clip of activeClips(doc, t)) {
        const v = videos.get(clip.mediaId)
        if (!v || !v.videoWidth) continue
        await seekTo(v, t - clip.start + clip.in)
        const s = Math.min(W / v.videoWidth, H / v.videoHeight)
        const w = v.videoWidth * s
        const h = v.videoHeight * s
        ctx.drawImage(v, (W - w) / 2, (H - h) / 2, w, h)
      }
      const frame = new VideoFrame(canvas, { timestamp: (i / FPS) * 1e6, duration: 1e6 / FPS })
      videoEncoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 })
      frame.close()
      // backpressure: don't let raw frames pile up ahead of the encoder
      if (videoEncoder.encodeQueueSize > 8)
        await new Promise((r) => videoEncoder.addEventListener('dequeue', r, { once: true }))
    }

    await Promise.all([videoEncoder.flush(), audioEncoder.flush()])
    if (failure) throw failure
    muxer.finalize()
    download(new Blob([muxer.target.buffer], { type: 'video/webm' }))
  } finally {
    videoEncoder.close()
    audioEncoder.close()
    for (const v of videos.values()) v.removeAttribute('src')
  }
}

function download(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'export.webm'
  a.click()
  URL.revokeObjectURL(url)
}

// Fallback for browsers without WebCodecs: record the preview canvas while the
// timeline plays — realtime, tab must stay visible, and video only.
function exportRealtime(canvas: HTMLCanvasElement): Promise<void> {
  return new Promise((resolve) => {
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = () => {
      download(new Blob(chunks, { type: 'video/webm' }))
      resolve()
    }

    dispatch({ type: 'SEEK', time: 0 })
    dispatch({ type: 'PLAY' })
    rec.start()

    // subscribe only after PLAY — SEEK notifies with playing still false, and
    // subscribing earlier made that first notification stop a recording that
    // hadn't started, so the recorder then ran forever
    const unsub = useEditor.subscribe((state) => {
      if (!state.session.playing) {
        // playback hit the end of the doc (TICK auto-pauses) or user stopped
        unsub()
        rec.stop()
      }
    })
  })
}
