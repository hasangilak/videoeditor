'use client'
import { useEditor, dispatch, type Doc, type Media } from './store'
import { extractPeaks } from './waveform'
import { probeDuration } from './media'

// Browser-only persistence: file bytes in IndexedDB, doc + media metadata
// in localStorage. The backend stays storage-only.
const DB = 'reel'
const FILES = 'files'
const KEY = 'reel-project'

type SavedMedia = Pick<Media, 'id' | 'name' | 'duration'>

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(FILES)
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

export async function saveFile(id: string, file: File) {
  const db = await idb()
  db.transaction(FILES, 'readwrite').objectStore(FILES).put(file, id)
}

export async function deleteFile(id: string) {
  const db = await idb()
  db.transaction(FILES, 'readwrite').objectStore(FILES).delete(id)
}

function loadFile(db: IDBDatabase, id: string): Promise<File | undefined> {
  return new Promise((res) => {
    const req = db.transaction(FILES).objectStore(FILES).get(id)
    req.onsuccess = () => res(req.result as File | undefined)
    req.onerror = () => res(undefined)
  })
}

/** Debounced autosave of doc + media metadata. Returns the unsubscribe. */
export function startAutosave() {
  let t: ReturnType<typeof setTimeout> | undefined
  return useEditor.subscribe((s, prev) => {
    if (s.doc === prev.doc && s.media === prev.media) return
    clearTimeout(t)
    t = setTimeout(() => {
      const media: SavedMedia[] = Object.values(s.media)
        .filter((m) => m.status === 'ready')
        .map(({ id, name, duration }) => ({ id, name, duration }))
      localStorage.setItem(KEY, JSON.stringify({ doc: s.doc, media }))
    }, 300)
  })
}

/** Rebuild the project from the last autosave; clips whose bytes are gone are dropped. */
export async function restore() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { doc: Doc; media: SavedMedia[] }
    const db = await idb()
    const media: Record<string, Media> = {}
    for (const m of saved.media) {
      const file = await loadFile(db, m.id)
      if (!file) continue
      const url = URL.createObjectURL(file)
      media[m.id] = {
        ...m,
        url,
        status: 'ready',
        // ponytail: assumes the earlier upload finished; wire tus fingerprint
        // lookup here if partial uploads across reloads need to resume
        upload: { pct: 100, state: 'done' },
      }
      probeDuration(m.id, url) // regenerates the thumbnail
      extractPeaks(file).then(
        (peaks) => peaks && dispatch({ type: 'WAVEFORM_READY', id: m.id, peaks }),
      )
    }
    const clips = Object.fromEntries(
      Object.entries(saved.doc.clips).filter(([, c]) => media[c.mediaId]),
    )
    dispatch({ type: 'RESTORED', doc: { clips }, media })
  } catch (err) {
    // corrupt or unavailable storage — start fresh rather than crash
    console.error('[reel] restore failed:', err)
  }
}
