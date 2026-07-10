'use client'
import { useEditor, dispatch, docDuration } from '@/lib/store'
import { fmt } from '@/lib/format'

export default function Transport() {
  const playing = useEditor((s) => s.session.playing)
  const playhead = useEditor((s) => s.session.playhead)
  const duration = useEditor((s) => docDuration(s.doc))

  return (
    <div className="flex items-center justify-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
      <button
        onClick={() => dispatch({ type: 'SEEK', time: 0 })}
        className="text-zinc-400 transition hover:text-white"
        title="Go to start"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 2h2v12H3zM13 2 6 8l7 6z" />
        </svg>
      </button>
      <button
        onClick={() => dispatch({ type: playing ? 'PAUSE' : 'PLAY' })}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-400"
        title="Play / pause (space)"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 2h4v12H3zM9 2h4v12H9z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2l10 6-10 6z" />
          </svg>
        )}
      </button>
      <span className="font-mono text-xs tabular-nums text-zinc-400">
        <span className="text-zinc-100">{fmt(playhead)}</span> / {fmt(duration)}
      </span>
    </div>
  )
}
