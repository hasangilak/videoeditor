'use client'
import { useEditor, dispatch, docDuration } from './store'

// ponytail: realtime video-only export — records the preview canvas while the
// timeline plays, so a 3-minute edit takes 3 minutes and needs the tab
// visible. Faster-than-realtime + audio needs WebCodecs/OfflineAudioContext.
export function exportTimeline(canvas: HTMLCanvasElement): Promise<void> {
  const s = useEditor.getState()
  if (docDuration(s.doc) === 0 || s.session.playing) return Promise.resolve()

  return new Promise((resolve) => {
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'export.webm'
      a.click()
      URL.revokeObjectURL(url)
      resolve()
    }

    const unsub = useEditor.subscribe((state) => {
      if (!state.session.playing) {
        // playback hit the end of the doc (TICK auto-pauses) or user stopped
        unsub()
        rec.stop()
      }
    })

    dispatch({ type: 'SEEK', time: 0 })
    dispatch({ type: 'PLAY' })
    rec.start()
  })
}
