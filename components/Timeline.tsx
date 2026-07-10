'use client'
import { useEffect, useRef } from 'react'
import { useEditor, dispatch, docDuration, TRACKS, type Clip, type Drag, type Media } from '@/lib/store'
import { fmt } from '@/lib/format'
import { drawWaveform } from '@/lib/waveform'

const RULER_H = 24
const TRACK_H = 56

const WAVE_H = 26

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
    drawWaveform(c, peaks, { color: 'rgba(255,255,255,0.45)', from, to })
  }, [peaks, from, to, width])
  if (!peaks) return null
  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-x-0 bottom-0 w-full"
      style={{ height: WAVE_H }}
    />
  )
}

export default function Timeline() {
  const doc = useEditor((s) => s.doc)
  const { playhead, pxPerSec, selection, drag } = useEditor((s) => s.session)
  const media = useEditor((s) => s.media)
  const scroller = useRef<HTMLDivElement>(null)

  const duration = docDuration(doc)
  const width = Math.max(duration + 10, 30) * pxPerSec

  const timeAt = (clientX: number) => {
    const el = scroller.current!
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft
    return Math.max(0, x / pxPerSec)
  }

  const scrub = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dispatch({ type: 'PAUSE' })
    dispatch({ type: 'SEEK', time: timeAt(e.clientX) })
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

  const labelStep = Math.max(1, Math.round(80 / pxPerSec))
  const marks = Array.from({ length: Math.ceil(width / pxPerSec / labelStep) }, (_, i) => i * labelStep)

  return (
    <div className="flex h-56 shrink-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Timeline</h2>
        <div className="flex items-center gap-2 text-zinc-400">
          <button
            onClick={() => dispatch({ type: 'UNDO' })}
            className="rounded px-1.5 text-xs hover:bg-zinc-800"
            title="Undo (⌘Z)"
          >
            ↺
          </button>
          <button
            onClick={() => dispatch({ type: 'REDO' })}
            className="rounded px-1.5 text-xs hover:bg-zinc-800"
            title="Redo (⇧⌘Z)"
          >
            ↻
          </button>
          <span className="mx-1 h-3 w-px bg-zinc-800" />
          <button onClick={() => dispatch({ type: 'ZOOM', pxPerSec: pxPerSec / 1.5 })} className="rounded px-1.5 hover:bg-zinc-800">−</button>
          <span className="w-14 text-center font-mono text-[10px]">{Math.round(pxPerSec)} px/s</span>
          <button onClick={() => dispatch({ type: 'ZOOM', pxPerSec: pxPerSec * 1.5 })} className="rounded px-1.5 hover:bg-zinc-800">+</button>
        </div>
      </div>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="relative" style={{ width, height: RULER_H + TRACKS.length * (TRACK_H + 8) + 8 }}>
          {/* ruler — pointer down anywhere on it seeks */}
          <div
            onPointerDown={scrub}
            onPointerMove={(e) => e.buttons === 1 && dispatch({ type: 'SEEK', time: timeAt(e.clientX) })}
            className="sticky top-0 cursor-col-resize border-b border-zinc-800/80 bg-zinc-900"
            style={{ height: RULER_H }}
          >
            {marks.map((t) => (
              <span
                key={t}
                className="absolute bottom-0 border-l border-zinc-700 pl-1 font-mono text-[9px] leading-4 text-zinc-500"
                style={{ left: t * pxPerSec, height: 14 }}
              >
                {fmt(t)}
              </span>
            ))}
          </div>

          {/* tracks */}
          {TRACKS.map((trackId, row) => (
            <div
              key={trackId}
              onPointerDown={scrub}
              className="absolute right-0 left-0 rounded-md bg-zinc-950/60"
              style={{ top: RULER_H + 8 + row * (TRACK_H + 8), height: TRACK_H }}
            >
              <span className="absolute top-1 left-1.5 z-10 font-mono text-[9px] text-zinc-600">
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
                      onPointerDown={(e) => startClipDrag(e, c, 'move')}
                      className={`group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-lg border bg-gradient-to-b from-indigo-500/90 to-indigo-600/90 active:cursor-grabbing ${
                        selected ? 'border-white/90 shadow-lg shadow-indigo-500/30' : 'border-indigo-400/40'
                      }`}
                      style={{ left: g.start * pxPerSec, width: (g.out - g.in) * pxPerSec }}
                    >
                      <span className="pointer-events-none absolute inset-x-2 top-1.5 truncate text-[10px] font-medium text-white/90">
                        {m?.name}
                      </span>
                      <ClipWave
                        media={m}
                        from={m ? g.in / m.duration : 0}
                        to={m ? g.out / m.duration : 1}
                        width={(g.out - g.in) * pxPerSec}
                      />
                      <span className="pointer-events-none absolute bottom-1 left-2 font-mono text-[9px] text-white/50">
                        {fmt(g.out - g.in)}
                      </span>
                      <div
                        onPointerDown={(e) => startClipDrag(e, c, 'trim-l')}
                        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 transition group-hover:bg-white/25"
                      />
                      <div
                        onPointerDown={(e) => startClipDrag(e, c, 'trim-r')}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 transition group-hover:bg-white/25"
                      />
                    </div>
                  )
                })}
            </div>
          ))}

          {/* playhead */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-rose-500"
            style={{ left: playhead * pxPerSec }}
          >
            <div className="absolute -top-0 -left-[5px] h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-rose-500" />
          </div>
        </div>
      </div>
    </div>
  )
}
