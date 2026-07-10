'use client'
import { useEffect } from 'react'
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
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function Editor() {
  usePlaybackEngine()
  useKeyboard()
  useEffect(() => {
    restore()
    return startAutosave()
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex min-h-0 flex-1 gap-3">
        <MediaBin />
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          <Preview />
          <Transport />
        </main>
      </div>

      <Timeline />
    </div>
  )
}
