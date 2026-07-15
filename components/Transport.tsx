'use client'
import { useState } from 'react'
import { useEditor, dispatch, docDuration } from '@/lib/store'
import { exportTimeline } from '@/lib/export'
import { fmt } from '@/lib/format'
import { glassBtn } from '@/lib/ui'

const glass = `${glassBtn} h-10 w-10`

export default function Transport() {
  const playing = useEditor((s) => s.session.playing)
  const playhead = useEditor((s) => s.session.playhead)
  const pxPerSec = useEditor((s) => s.session.pxPerSec)
  const markIn = useEditor((s) => s.session.markIn)
  const markOut = useEditor((s) => s.session.markOut)
  const duration = useEditor((s) => docDuration(s.doc))
  const [exporting, setExporting] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)

  const onExport = async () => {
    const canvas = document.getElementById('preview-canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return
    setExporting(true)
    setExportFailed(false)
    try {
      await exportTimeline(canvas)
    } catch (err) {
      // a failed render must never leave the button stuck on "Exporting…"
      console.error('[reel] export failed:', err)
      setExportFailed(true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2 px-4 pb-4 pt-3">
      <button
        onClick={() => dispatch({ type: 'SEEK', time: 0 })}
        className={glass}
        title="Go to start"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 2h2v12H3zM13 2 6 8l7 6z" />
        </svg>
      </button>
      <button
        onClick={() => dispatch({ type: playing ? 'PAUSE' : 'PLAY' })}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-lime-300 text-zinc-900 transition hover:bg-lime-200"
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
      {/* with marks set the scissors razor at both lines (nothing removed); otherwise split at the playhead */}
      <button
        onClick={() => dispatch({ type: 'SPLIT' })}
        className={`${glass} ${markIn !== null && markOut !== null ? '!bg-rose-400/80 !text-zinc-900' : ''}`}
        title={
          markIn !== null && markOut !== null
            ? 'Split at the I and O lines (S)'
            : 'Split clip at playhead (S)'
        }
      >
        ✂
      </button>
      <button
        onClick={() =>
          dispatch(
            markIn !== null
              ? { type: 'MARK_CLEARED', which: 'in' }
              : { type: 'MARK_IN', time: useEditor.getState().session.playhead },
          )
        }
        className={`${glass} font-mono text-xs font-bold ${markIn !== null ? '!bg-rose-400/80 !text-zinc-900' : ''}`}
        title={markIn !== null ? 'Clear cut start' : 'Mark cut start at playhead (I)'}
      >
        I
      </button>
      <button
        onClick={() =>
          dispatch(
            markOut !== null
              ? { type: 'MARK_CLEARED', which: 'out' }
              : { type: 'MARK_OUT', time: useEditor.getState().session.playhead },
          )
        }
        className={`${glass} font-mono text-xs font-bold ${markOut !== null ? '!bg-rose-400/80 !text-zinc-900' : ''}`}
        title={markOut !== null ? 'Clear cut end' : 'Mark cut end at playhead (O)'}
      >
        O
      </button>
      <button
        onClick={() => dispatch({ type: 'CUT_RANGE' })}
        disabled={markIn === null || markOut === null || Math.abs(markOut - markIn) < 0.1}
        className={`${glass} disabled:opacity-40 ${
          markIn !== null && markOut !== null ? '!bg-rose-400/80 !text-zinc-900' : ''
        }`}
        title="Remove the marked range and close the gap (X) — Esc clears marks"
      >
        ✖
      </button>

      {/* center strip: lime pills on dark glass, like the mock's setting chips.
          Viewport-centered on md+; below md it drops into the flow and wraps
          onto its own centered row so it can't collide with the side buttons */}
      <div className="mx-auto flex items-center gap-2 rounded-full bg-zinc-900/70 p-1.5 backdrop-blur-xl max-md:order-last md:absolute md:left-1/2 md:-translate-x-1/2">
        <span
          data-testid="timecode"
          className="whitespace-nowrap rounded-full bg-lime-300 px-4 py-1.5 font-mono text-xs font-semibold tabular-nums text-zinc-900"
        >
          <span>{fmt(playhead)}</span> / {fmt(duration)}
        </span>
        <div className="flex items-center rounded-full bg-lime-300 px-1.5 py-1.5 text-zinc-900">
          <button
            onClick={() => dispatch({ type: 'ZOOM', pxPerSec: pxPerSec / 1.5 })}
            className="rounded-full px-2 font-bold hover:bg-lime-200"
          >
            −
          </button>
          <span className="w-14 text-center font-mono text-[10px] font-semibold">
            {Math.round(pxPerSec)} px/s
          </span>
          <button
            onClick={() => dispatch({ type: 'ZOOM', pxPerSec: pxPerSec * 1.5 })}
            className="rounded-full px-2 font-bold hover:bg-lime-200"
          >
            +
          </button>
        </div>
        <button
          onClick={onExport}
          disabled={exporting || playing || duration === 0}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold text-zinc-900 transition disabled:opacity-40 ${
            exportFailed ? 'bg-rose-400 hover:bg-rose-300' : 'bg-lime-300 hover:bg-lime-200'
          }`}
          title={
            exportFailed
              ? 'Export failed — the browser refused to decode. Retry, or reload the tab.'
              : 'Render the timeline and save it as .webm'
          }
        >
          {exporting ? 'Exporting…' : exportFailed ? 'Export failed — retry' : 'Export'}
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button onClick={() => dispatch({ type: 'UNDO' })} className={glass} title="Undo (⌘Z)">
          ↺
        </button>
        <button onClick={() => dispatch({ type: 'REDO' })} className={glass} title="Redo (⇧⌘Z)">
          ↻
        </button>
      </div>
    </div>
  )
}
