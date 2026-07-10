'use client'
import { useEffect, useRef } from 'react'
import { useEditor, activeClips, type Media } from '@/lib/store'

const W = 1280
const H = 720

// decoder pool: one hidden <video> PER CLIP (not per media — two clips using
// the same media at different offsets would fight over one element's
// currentTime, a seek storm that never presents a frame). Module scope so it
// survives route changes along with the store.
const pool: Record<string, HTMLVideoElement> = {}

function videoFor(clipId: string, media: Media) {
  let v = pool[clipId]
  if (!v) {
    v = document.createElement('video')
    v.preload = 'auto'
    v.playsInline = true
    pool[clipId] = v
  }
  if (v.src !== media.url) v.src = media.url // restore() mints fresh object URLs
  return v
}

/**
 * The compositor: every frame paints composite(doc, playhead) onto the canvas,
 * bottom track first, top track (v1) last. The <video> elements are pure
 * decoders — state is the clock, they follow it.
 */
export default function Preview() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      // fast lane: read state directly per frame, no React re-render
      const { doc, session, media } = useEditor.getState()
      const clips = activeClips(doc, session.playhead)
      const activeIds = new Set(clips.map((c) => c.id))

      for (const [id, v] of Object.entries(pool)) {
        if (!doc.clips[id]) {
          // clip deleted (or split renamed it) — release the decoder
          v.removeAttribute('src')
          delete pool[id]
        } else if (!activeIds.has(id) && !v.paused) v.pause()
      }

      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)

      if (clips.length === 0) {
        ctx.fillStyle = '#52525c'
        ctx.font = '600 18px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText('NO CLIP AT PLAYHEAD', W / 2, H / 2)
        return
      }

      for (const clip of clips) {
        const m = media[clip.mediaId]
        if (!m) continue
        const v = videoFor(clip.id, m)
        const want = session.playhead - clip.start + clip.in
        // ponytail: rAF clock is master, videos drift-corrected — swap to
        // audio-clock master if lip-sync matters
        const tolerance = session.playing ? 0.25 : 0.03
        if (!v.seeking && Math.abs(v.currentTime - want) > tolerance) v.currentTime = want
        if (session.playing && v.paused) v.play().catch(() => {})
        if (!session.playing && !v.paused) v.pause()

        if (v.readyState >= 2 && v.videoWidth) {
          const s = Math.min(W / v.videoWidth, H / v.videoHeight)
          const w = v.videoWidth * s
          const h = v.videoHeight * s
          ctx.drawImage(v, (W - w) / 2, (H - h) / 2, w, h)
        }
      }
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-black">
      <canvas
        id="preview-canvas"
        ref={canvas}
        width={W}
        height={H}
        className="h-full w-full object-contain"
      />
    </div>
  )
}
