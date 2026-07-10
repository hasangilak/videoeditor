'use client'
import { useRef, useState } from 'react'
import { useEditor, dispatch, TRACKS } from '@/lib/store'
import { importFiles } from '@/lib/media'
import { fmt } from '@/lib/format'

export default function MediaBin() {
  const media = useEditor((s) => s.media)
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const items = Object.values(media)

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Media</h2>
        <button
          onClick={() => input.current?.click()}
          className="rounded-md bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-400"
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
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-dashed p-2 transition ${
          over ? 'border-indigo-400 bg-indigo-500/10' : 'border-zinc-800'
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
          <div key={m.id} className="group rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium text-zinc-200">{m.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                {m.status === 'ready' && fmt(m.duration)}
                {m.status === 'loading' && '…'}
                {m.status === 'error' && <span className="text-rose-400">cannot decode</span>}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-all ${
                  m.upload.state === 'error'
                    ? 'bg-rose-500'
                    : m.upload.state === 'done'
                      ? 'bg-emerald-500'
                      : m.upload.state === 'paused'
                        ? 'bg-amber-500'
                        : 'bg-indigo-500'
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
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-indigo-500 hover:text-white disabled:opacity-40"
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
