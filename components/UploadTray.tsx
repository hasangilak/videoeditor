'use client'
import { useEffect } from 'react'
import { useEditor } from '@/lib/store'
import { pauseUpload, resumeUpload } from '@/lib/media'

/**
 * Lives in the root layout, outside every route — the visible face of the
 * module-scope upload manager. Navigating routes unmounts pages, not this.
 */
export default function UploadTray() {
  const media = useEditor((s) => s.media)
  const active = Object.values(media).filter((m) => m.upload.state !== 'done')
  const uploading = active.some((m) => m.upload.state === 'uploading')

  // a 500GB transfer should not die to a stray ⌘W
  useEffect(() => {
    if (!uploading) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploading])

  if (active.length === 0) return null

  return (
    // top-left beside the editor rail: the old bottom-left slot floated over the
    // timeline and swallowed pointer input meant for the clips underneath
    <div className="fixed top-4 left-20 z-50 w-72 rounded-2xl border border-white/10 bg-zinc-900/70 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400">
        Uploads
      </h3>
      <div className="flex flex-col gap-2.5">
        {active.map((m) => (
          <div key={m.id}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-zinc-200">{m.name}</span>
              <button
                onClick={() =>
                  m.upload.state === 'uploading' ? pauseUpload(m.id) : resumeUpload(m.id)
                }
                className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-700"
              >
                {m.upload.state === 'uploading' ? 'Pause' : m.upload.state === 'error' ? 'Retry' : 'Resume'}
              </button>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-all ${
                  m.upload.state === 'error'
                    ? 'bg-rose-500'
                    : m.upload.state === 'paused'
                      ? 'bg-amber-500'
                      : 'bg-lime-300'
                }`}
                style={{ width: `${m.upload.pct}%` }}
              />
            </div>
            <span className="mt-0.5 block text-[10px] text-zinc-500">
              {m.upload.state} · {m.upload.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
