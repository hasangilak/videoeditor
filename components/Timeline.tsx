'use client'
import { useEffect, useRef, useState } from 'react'
import { useEditor, dispatch, docDuration, activeClip, timelineHover, TRACKS, type Clip, type Drag, type Media } from '@/lib/store'
import { fmt } from '@/lib/format'
import { drawWaveform } from '@/lib/waveform'

const RULER_H = 48
const TRACK_H = 64

const WAVE_H = 20

function ClipWave({
  media,
  from,
  to,
  width,
}: {
  media: Media | undefined
  from: number
  to: number
  width: number // clip width in CSS px — canvas renders at this size, not stretched
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const peaks = media?.waveform
  useEffect(() => {
    const c = ref.current
    if (!c || !peaks) return
    const dpr = window.devicePixelRatio || 1
    // ponytail: canvas capped at 8k device px; CSS stretches past that (only
    // hit on very long clips at high zoom) — tile canvases if it ever matters
    c.width = Math.max(1, Math.min(8192, Math.round(width * dpr)))
    c.height = Math.round(WAVE_H * dpr)
    drawWaveform(c, peaks, { color: 'rgba(255,255,255,0.8)', from, to })
  }, [peaks, from, to, width])
  if (!peaks) return null
  return (
    <>
      {/* scrim keeps the wave legible over bright filmstrip frames */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/50 to-transparent"
        style={{ height: WAVE_H + 8 }}
      />
      <canvas
        ref={ref}
        className="pointer-events-none absolute inset-x-0 bottom-0 w-full"
        style={{ height: WAVE_H }}
      />
    </>
  )
}

const THUMB_W = 160
const THUMB_H = 90

// one shared hidden <video> for hover scrubbing — only one tooltip exists at a time
let hoverV: HTMLVideoElement | null = null

function HoverThumb({ time }: { time: number }) {
  const doc = useEditor((s) => s.doc)
  const media = useEditor((s) => s.media)
  const ref = useRef<HTMLCanvasElement>(null)
  const clip = activeClip(doc, time)
  const m = clip ? media[clip.mediaId] : undefined

  useEffect(() => {
    if (!clip || !m) return
    if (!hoverV) {
      hoverV = document.createElement('video')
      hoverV.preload = 'auto'
      hoverV.muted = true
    }
    const v = hoverV
    if (v.src !== m.url) v.src = m.url
    const want = time - clip.start + clip.in
    const draw = () => {
      const ctx = ref.current?.getContext('2d')
      if (!ctx || !v.videoWidth) return
      const s = Math.min(THUMB_W / v.videoWidth, THUMB_H / v.videoHeight)
      const w = v.videoWidth * s
      const h = v.videoHeight * s
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, THUMB_W, THUMB_H)
      ctx.drawImage(v, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h)
    }
    // coalesce seeks: while one is in flight, onseeked re-aims at the latest want
    v.onseeked = () => (Math.abs(v.currentTime - want) > 0.05 ? void (v.currentTime = want) : draw())
    if (!v.seeking) {
      if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want
      else draw()
    }
  }, [clip, m, time])

  if (!m) return null
  return <canvas ref={ref} width={THUMB_W} height={THUMB_H} className="block" />
}

export default function Timeline() {
  const doc = useEditor((s) => s.doc)
  const { playhead, pxPerSec, selection, drag, markIn, markOut } = useEditor((s) => s.session)
  const media = useEditor((s) => s.media)
  const scroller = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null) // hovered time (s)

  const duration = docDuration(doc)
  const width = Math.max(duration + 10, 30) * pxPerSec

  const timeAt = (clientX: number) => {
    const el = scroller.current!
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft
    return Math.max(0, x / pxPerSec)
  }

  // re-register every render so the resolver closes over the current pxPerSec;
  // I/O shortcuts call it at keypress time, reading live scroll/zoom state
  useEffect(() => {
    timelineHover.timeAt = timeAt
  })
  useEffect(
    () => () => {
      // pointerleave never fires on unmount — clear by hand or the ref goes stale
      timelineHover.x = null
      timelineHover.timeAt = null
    },
    [],
  )

  const scrub = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dispatch({ type: 'PAUSE' })
    dispatch({ type: 'SEEK', time: timeAt(e.clientX) })
  }

  // drag on the track area pans the timeline; a plain click still seeks
  const pan = (e: React.PointerEvent) => {
    const el = scroller.current
    if (!el) return
    const x0 = e.clientX
    const scroll0 = el.scrollLeft
    let moved = false
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true
      if (moved) el.scrollLeft = scroll0 - (ev.clientX - x0)
    }
    const up = (ev: PointerEvent) => {
      if (!moved) {
        dispatch({ type: 'PAUSE' })
        dispatch({ type: 'SEEK', time: timeAt(ev.clientX) })
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startClipDrag = (e: React.PointerEvent, clip: Clip, mode: Drag['mode']) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dispatch({ type: 'SELECT', clipId: clip.id })
    const x0 = e.clientX
    const orig = { ...clip }
    const srcDuration = media[clip.mediaId]?.duration ?? clip.out

    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pxPerSec
      let d: Drag = { clipId: clip.id, mode, start: orig.start, in: orig.in, out: orig.out }
      if (mode === 'move') d.start = Math.max(0, orig.start + dt)
      if (mode === 'trim-l') {
        const nin = Math.min(Math.max(orig.in + dt, 0), orig.out - 0.1)
        d = { ...d, in: nin, start: orig.start + (nin - orig.in) }
      }
      if (mode === 'trim-r')
        d.out = Math.min(Math.max(orig.out + dt, orig.in + 0.1), srcDuration)
      dispatch({ type: 'DRAG_MOVED', drag: d })
    }
    const up = () => {
      // 200 pointermoves = 1 doc mutation = 1 undo step
      dispatch({ type: 'DRAG_COMMITTED' })
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // drag a mark flag to move it; a plain click removes the mark
  const dragMark = (e: React.PointerEvent, type: 'MARK_IN' | 'MARK_OUT') => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    let moved = false
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true
      if (moved) dispatch({ type, time: timeAt(ev.clientX) })
    }
    const up = () => {
      if (!moved)
        dispatch({ type: 'MARK_CLEARED', which: type === 'MARK_IN' ? 'in' : 'out' })
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const labelStep = Math.max(1, Math.round(80 / pxPerSec))
  const marks = Array.from({ length: Math.ceil(width / pxPerSec / labelStep) }, (_, i) => i * labelStep)
  const label = (t: number) => (t < 60 ? `${t}s` : fmt(t))

  return (
    <div
      ref={scroller}
      onPointerMove={(e) => (timelineHover.x = e.clientX)}
      onPointerLeave={() => (timelineHover.x = null)}
      className="relative overflow-x-auto overflow-y-hidden"
    >
      <div className="relative" style={{ width, height: RULER_H + TRACKS.length * (TRACK_H + 8) + 8 }}>
        {/* ruler — pointer down anywhere on it seeks */}
        <div
          onPointerDown={scrub}
          onPointerMove={(e) => {
            const t = timeAt(e.clientX)
            setHover(t)
            if (e.buttons === 1) dispatch({ type: 'SEEK', time: t })
          }}
          onPointerLeave={() => setHover(null)}
          className="sticky top-0 cursor-col-resize"
          style={{ height: RULER_H }}
        >
          {/* scrub line with end caps */}
          <div className="absolute inset-x-0 top-3 h-px bg-lime-300/60" />
          <div className="absolute top-[9px] left-0 h-1.5 w-1.5 rounded-full bg-lime-300" />
          <div className="absolute top-[9px] right-0 h-1.5 w-1.5 rounded-full bg-lime-300" />
          {marks.map((t) => (
            <span
              key={t}
              className="absolute bottom-0 -translate-x-1/2 font-mono text-[11px] leading-4 text-zinc-300"
              style={{ left: t * pxPerSec }}
            >
              {label(t)}
            </span>
          ))}
          {/* dotted minor ticks between labels */}
          {marks.slice(1).flatMap((t) =>
            [1, 2, 3, 4].map((i) => (
              <span
                key={`${t}.${i}`}
                className="absolute bottom-[7px] h-0.5 w-0.5 rounded-full bg-zinc-500"
                style={{ left: (t - (labelStep * i) / 5) * pxPerSec }}
              />
            )),
          )}
        </div>

        {/* tracks */}
        {TRACKS.map((trackId, row) => (
          <div
            key={trackId}
            onPointerDown={pan}
            className="absolute right-0 left-0 cursor-grab rounded-2xl bg-white/[0.04] active:cursor-grabbing"
            style={{ top: RULER_H + 8 + row * (TRACK_H + 8), height: TRACK_H }}
          >
            <span className="absolute top-1 left-2 z-10 font-mono text-[9px] text-zinc-500">
              {trackId.toUpperCase()}
            </span>
            {Object.values(doc.clips)
              .filter((c) => c.trackId === trackId)
              .map((c) => {
                // render from ghost values while this clip is mid-gesture
                const g = drag?.clipId === c.id ? drag : c
                const m = media[c.mediaId]
                const selected = selection === c.id
                return (
                  <div
                    key={c.id}
                    data-clip={c.id}
                    onPointerDown={(e) => startClipDrag(e, c, 'move')}
                    className={`group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-[18px] border-2 bg-zinc-800 active:cursor-grabbing ${
                      selected ? 'border-lime-300 shadow-lg shadow-lime-400/20' : 'border-white/15'
                    }`}
                    style={{
                      left: g.start * pxPerSec,
                      width: (g.out - g.in) * pxPerSec,
                      // filmstrip: tile the poster frame across the clip
                      backgroundImage: m?.thumb ? `url(${m.thumb})` : undefined,
                      backgroundSize: 'auto 100%',
                      backgroundRepeat: 'repeat-x',
                    }}
                  >
                    <span className="pointer-events-none absolute inset-x-7 top-1 truncate text-[10px] font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
                      {m?.name}
                    </span>
                    <ClipWave
                      media={m}
                      from={m ? g.in / m.duration : 0}
                      to={m ? g.out / m.duration : 1}
                      width={(g.out - g.in) * pxPerSec}
                    />
                    <span className="pointer-events-none absolute bottom-1 left-7 font-mono text-[9px] text-white/70 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
                      {fmt(g.out - g.in)}
                    </span>
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => dispatch({ type: 'CLIP_REMOVED', clipId: c.id })}
                      title="Remove clip (Delete)"
                      className={`absolute top-1 right-7 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-zinc-900/80 text-xs leading-none text-white/80 transition hover:bg-rose-500 hover:text-white group-hover:opacity-100 ${
                        selected ? 'opacity-100' : 'opacity-0'
                      }`}
                    >
                      ×
                    </button>
                    <div
                      onPointerDown={(e) => startClipDrag(e, c, 'trim-l')}
                      className={`absolute inset-y-0 left-0 flex w-6 cursor-ew-resize items-center pl-1 transition group-hover:opacity-100 ${
                        selected ? 'opacity-100' : 'opacity-0'
                      }`}
                    >
                      <div className="flex h-8 w-5 items-center justify-center rounded-full bg-lime-300 text-xs font-bold text-zinc-900">
                        ‹
                      </div>
                    </div>
                    <div
                      onPointerDown={(e) => startClipDrag(e, c, 'trim-r')}
                      className={`absolute inset-y-0 right-0 flex w-6 cursor-ew-resize items-center justify-end pr-1 transition group-hover:opacity-100 ${
                        selected ? 'opacity-100' : 'opacity-0'
                      }`}
                    >
                      <div className="flex h-8 w-5 items-center justify-center rounded-full bg-lime-300 text-xs font-bold text-zinc-900">
                        ›
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        ))}

        {/* hover frame preview */}
        {hover !== null && (
          <div
            data-testid="hover-thumb"
            className="pointer-events-none absolute z-30 -translate-x-1/2 overflow-hidden rounded-lg border border-white/15 bg-zinc-900/90 shadow-xl backdrop-blur"
            style={{
              left: Math.min(Math.max(hover * pxPerSec, THUMB_W / 2 + 4), width - THUMB_W / 2 - 4),
              top: RULER_H + 4,
            }}
          >
            <HoverThumb time={hover} />
            <div className="px-2 py-0.5 text-center font-mono text-[10px] text-zinc-300">
              {fmt(hover)}
            </div>
          </div>
        )}

        {/* cut-range markers — the shaded span between them is what CUT_RANGE removes */}
        {markIn !== null && markOut !== null && (
          <>
            <div
              data-testid="cut-range"
              className="pointer-events-none absolute top-3 bottom-0 z-10 border-x border-rose-400/60 bg-rose-400/10"
              style={{
                left: Math.min(markIn, markOut) * pxPerSec,
                width: Math.abs(markOut - markIn) * pxPerSec,
              }}
            />
            {Math.abs(markOut - markIn) >= 0.1 && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => dispatch({ type: 'CUT_RANGE' })}
                title="Remove the marked range and close the gap (X)"
                className="absolute top-[13px] z-30 flex h-6 -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full bg-rose-400 px-3 text-[11px] font-bold whitespace-nowrap text-zinc-900 shadow-md shadow-black/40 transition hover:bg-rose-300"
                style={{ left: ((markIn + markOut) / 2) * pxPerSec }}
              >
                ✂ Remove
              </button>
            )}
          </>
        )}
        {([['MARK_IN', markIn, 'I'], ['MARK_OUT', markOut, 'O']] as const).map(
          ([type, t, label]) =>
            t !== null && (
              // z-30: the flag must stay visible when it lands under the playhead pill
              <div key={type} className="absolute top-3 bottom-0 z-30" style={{ left: t * pxPerSec }}>
                <div className="pointer-events-none absolute inset-y-0 w-px bg-rose-400" />
                <div
                  data-testid={`mark-${label.toLowerCase()}`}
                  title="Drag to move — click to remove"
                  onPointerDown={(e) => dragMark(e, type)}
                  className={`absolute -top-1 flex h-5 w-5 cursor-ew-resize items-center justify-center rounded-full bg-rose-400 font-mono text-[10px] font-bold text-zinc-900 shadow-md shadow-black/40 transition hover:scale-125 ${
                    type === 'MARK_IN' ? '-translate-x-full rounded-r-none' : 'rounded-l-none'
                  }`}
                >
                  {/* keyed by time so the ping replays wherever the mark lands */}
                  <span
                    key={t}
                    className="pointer-events-none absolute inset-0 animate-ping rounded-[inherit] bg-rose-400"
                    style={{ animationIterationCount: 3 }}
                  />
                  <span className="relative">{label}</span>
                </div>
              </div>
            ),
        )}

        {/* playhead — hangs from the scrub line rather than crossing it */}
        <div
          className="pointer-events-none absolute top-3 bottom-0 z-20 w-px bg-lime-300"
          style={{ left: playhead * pxPerSec }}
        />
        {/* handle clamped so it stays visible when the playhead sits at 0 */}
        <div
          className="pointer-events-none absolute top-0 z-20 flex h-6 -translate-x-1/2 items-center gap-2 rounded-full bg-lime-300 px-3 text-xs font-bold text-zinc-900 shadow-md shadow-black/40"
          style={{ left: Math.max(playhead * pxPerSec, 26) }}
        >
          <span>‹</span>
          <span>›</span>
        </div>
      </div>
    </div>
  )
}
