'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useEditor, dispatch } from '@/lib/store'
import { restore, startAutosave } from '@/lib/persist'
import MediaBin from './MediaBin'
import Preview from './Preview'
import Transport from './Transport'
import Timeline from './Timeline'

/** rAF master clock: the only source of TICK actions while playing. */
function usePlaybackEngine() {
  const playing = useEditor((s) => s.session.playing)
  useEffect(() => {
    if (!playing) return
    const t0 = performance.now()
    const base = useEditor.getState().session.playhead
    let raf = 0
    const loop = (now: number) => {
      dispatch({ type: 'TICK', time: base + (now - t0) / 1000 })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing])
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const s = useEditor.getState().session
      if (e.code === 'Space') {
        e.preventDefault()
        dispatch({ type: s.playing ? 'PAUSE' : 'PLAY' })
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && s.selection) {
        dispatch({ type: 'CLIP_REMOVED', clipId: s.selection })
      } else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) {
        dispatch({ type: 'SPLIT_AT', time: s.playhead })
      } else if (e.key.toLowerCase() === 'i' && !e.metaKey && !e.ctrlKey) {
        dispatch({ type: 'MARK_IN', time: s.playhead })
      } else if (e.key.toLowerCase() === 'o' && !e.metaKey && !e.ctrlKey) {
        dispatch({ type: 'MARK_OUT', time: s.playhead })
      } else if (e.key.toLowerCase() === 'x' && !e.metaKey && !e.ctrlKey) {
        dispatch({ type: 'CUT_RANGE' })
      } else if (e.key === 'Escape') {
        dispatch({ type: 'MARKS_CLEARED' })
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

const rail =
  'flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-zinc-900/60 text-zinc-300 backdrop-blur-xl transition hover:text-white'

export default function Editor() {
  usePlaybackEngine()
  useKeyboard()
  useEffect(() => {
    restore()
    return startAutosave()
  }, [])

  const [bin, setBin] = useState(true)

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
      <Preview />

      {/* left rail */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        <button
          onClick={() => setBin((b) => !b)}
          title="Media"
          className={bin ? `${rail} !bg-lime-300 !text-zinc-900` : rail}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M3 9h18M8 5v14M16 5v14" />
          </svg>
        </button>
        <Link href="/library" title="Library" className={rail}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="8" height="8" rx="2" />
            <rect x="13" y="3" width="8" height="8" rx="2" />
            <rect x="3" y="13" width="8" height="8" rx="2" />
            <rect x="13" y="13" width="8" height="8" rx="2" />
          </svg>
        </Link>
      </div>

      {/* project title */}
      <div className="absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-zinc-900/60 px-5 py-2 text-sm font-semibold tracking-tight text-zinc-100 backdrop-blur-xl">
        reel
      </div>

      {bin && <MediaBin />}

      {/* bottom overlay: timeline + transport float over the preview */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/70 to-transparent pt-12">
        <div className="px-4">
          <Timeline />
        </div>
        <Transport />
      </div>
    </div>
  )
}
