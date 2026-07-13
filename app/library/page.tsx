'use client'
import { useEditor } from '@/lib/store'
import { fmt } from '@/lib/format'

export default function Library() {
  const media = useEditor((s) => s.media)
  const items = Object.values(media)

  return (
    <main className="flex-1 bg-zinc-950 p-6 text-zinc-100">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-400">
        Library
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing imported yet — go to the Editor and drop a video in. Uploads started there
          keep running while you browse here.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {items.map((m) => (
            <div key={m.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
              <video src={m.url} muted className="mb-2 aspect-video w-full rounded-lg bg-black object-contain" />
              <p className="truncate text-xs font-medium text-zinc-200">{m.name}</p>
              <p className="mt-1 font-mono text-[10px] text-zinc-500">
                {m.status === 'ready' ? fmt(m.duration) : 'probing…'} · {m.upload.state}
                {m.upload.state !== 'done' && ` ${m.upload.pct}%`}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
