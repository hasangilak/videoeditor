'use client'
import * as tus from 'tus-js-client'
import { dispatch } from './store'
import { extractPeaks } from './waveform'

// Uploads live here, at module scope — outside React entirely. Client-side
// route changes unmount components, never this module, so no portal/worker
// is needed to keep a transfer alive. Only a hard reload kills it, and tus
// fingerprints + chunked offsets make that resumable too.
const uploads: Record<string, tus.Upload> = {}

// Chrome defers media loading in hidden tabs, and a probe deferred that way
// may never complete — media imported in a background tab would stay stuck
// in 'loading'. Track unresolved probes and re-probe on tab visibility.
const pendingProbes = new Map<string, string>()

function probeDuration(id: string, url: string) {
  pendingProbes.set(id, url)
  const probe = document.createElement('video')
  probe.preload = 'metadata'
  probe.src = url
  probe.onloadedmetadata = () => {
    pendingProbes.delete(id)
    dispatch({ type: 'MEDIA_READY', id, duration: probe.duration })
  }
  probe.onerror = () => {
    pendingProbes.delete(id)
    dispatch({ type: 'MEDIA_ERROR', id })
  }
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    for (const [id, url] of pendingProbes) probeDuration(id, url)
  })

/** Import files: instant local playback via object URL, tus upload in background. */
export function importFiles(files: Iterable<File>) {
  for (const file of files) {
    const id = crypto.randomUUID()
    const url = URL.createObjectURL(file)

    dispatch({
      type: 'MEDIA_ADDED',
      media: {
        id,
        name: file.name,
        url,
        duration: 0,
        status: 'loading',
        upload: { pct: 0, state: 'uploading' },
      },
    })

    // probe duration in the browser — the backend never processes anything
    probeDuration(id, url)

    // ponytail: decodeAudioData buffers the whole file, so skip huge ones;
    // upgrade path is a streaming decoder in a worker
    if (file.size <= 200 * 1024 * 1024)
      extractPeaks(file).then(
        (peaks) => peaks && dispatch({ type: 'WAVEFORM_READY', id, peaks }),
      )

    const upload = new tus.Upload(file, {
      endpoint: '/api/tus',
      // chunked, so retries resume from the last acked offset instead of byte 0
      chunkSize: 64 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      metadata: { filename: file.name, filetype: file.type },
      onProgress: (sent, total) =>
        dispatch({ type: 'UPLOAD_PROGRESS', id, pct: Math.round((sent / total) * 100) }),
      onSuccess: () => {
        delete uploads[id]
        dispatch({ type: 'UPLOAD_STATE', id, state: 'done' })
      },
      onError: () => dispatch({ type: 'UPLOAD_STATE', id, state: 'error' }),
    })
    uploads[id] = upload

    // after a hard reload, re-picking the same file continues where it stopped
    upload.findPreviousUploads().then((prev) => {
      if (prev[0]) upload.resumeFromPreviousUpload(prev[0])
      upload.start()
    })
  }
}

export function pauseUpload(id: string) {
  uploads[id]?.abort()
  dispatch({ type: 'UPLOAD_STATE', id, state: 'paused' })
}

export function resumeUpload(id: string) {
  uploads[id]?.start()
  dispatch({ type: 'UPLOAD_STATE', id, state: 'uploading' })
}
