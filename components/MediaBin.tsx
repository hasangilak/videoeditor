'use client'
import { useRef, useState } from 'react'
import { useEditor, dispatch, TRACKS } from '@/lib/store'
import { importFiles, removeMedia } from '@/lib/media'
import { fmt } from '@/lib/format'

export default function MediaBin() {
  const media = useEditor((s) => s.media)
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const items = Object.values(media)

  return (
    // bottom offset clears the timeline+transport overlay (taller below md where
    // the transport wraps to two rows); 60vh floor keeps the bin from collapsing
    // to zero height in short windows. max-w keeps the left rail reachable.
    <aside className="absolute top-4 right-4 bottom-[min(320px,60vh)] z-20 flex w-80 max-w-[calc(100vw-96px)] flex-col gap-3 rounded-3xl border border-white/10 bg-zinc-900/70 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl max-md:bottom-[min(380px,60vh)]">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Media</h2>
        <button
          onClick={() => input.current?.click()}
          className="rounded-full bg-lime-300 px-3 py-1 text-xs font-semibold text-zinc-900 transition hover:bg-lime-200"
        >
          Import
        </button>
        <input
          ref={input}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => e.target.files && importFiles(e.target.files)}
        />
      </div>

      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          importFiles(e.dataTransfer.files)
        }}
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-dashed p-2 transition ${
          over ? 'border-lime-300 bg-lime-300/10' : 'border-white/10'
        }`}
      >
        {items.length === 0 && (
          <p className="m-auto px-4 text-center text-xs leading-5 text-zinc-500">
            Drop video files here
            <br />
            or click Import
          </p>
        )}
        {items.map((m) => (
          <div key={m.id} className="group rounded-xl border border-white/10 bg-zinc-900/60 p-2.5">
            <div className="flex items-center gap-2.5">
              {m.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL
                <img src={m.thumb} alt="" className="h-9 w-16 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="h-9 w-16 shrink-0 rounded-md bg-zinc-800" />
              )}
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-200">{m.name}</span>
                <span className="font-mono text-[10px] text-zinc-500">
                  {m.status === 'ready' && fmt(m.duration)}
                  {m.status === 'loading' && '…'}
                  {m.status === 'error' && <span className="text-rose-400">cannot decode</span>}
                </span>
              </div>
              <button
                onClick={() => removeMedia(m.id)}
                title="Remove import (also removes its clips)"
                className="shrink-0 self-start rounded-full px-1.5 text-sm leading-5 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-400"
              >
                ×
              </button>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-all ${
                  m.upload.state === 'error'
                    ? 'bg-rose-500'
                    : m.upload.state === 'done'
                      ? 'bg-lime-300'
                      : m.upload.state === 'paused'
                        ? 'bg-amber-500'
                        : 'bg-lime-300'
                }`}
                style={{ width: `${m.upload.state === 'done' ? 100 : m.upload.pct}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-zinc-500">
                {m.upload.state === 'uploading' && `uploading ${m.upload.pct}%`}
                {m.upload.state === 'paused' && `paused ${m.upload.pct}%`}
                {m.upload.state === 'done' && 'uploaded'}
                {m.upload.state === 'error' && 'upload failed'}
              </span>
              <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                {TRACKS.map((t) => (
                  <button
                    key={t}
                    disabled={m.status !== 'ready'}
                    onClick={() => dispatch({ type: 'CLIP_ADDED', mediaId: m.id, trackId: t })}
                    className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-lime-300 hover:text-zinc-900 disabled:opacity-40"
                  >
                    + {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
