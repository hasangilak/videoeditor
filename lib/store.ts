'use client'
import { create } from 'zustand'

// ---------- types ----------

export type TrackId = 'v1' | 'v2'
export const TRACKS: TrackId[] = ['v1', 'v2'] // v1 renders on top in the preview

export interface Media {
  id: string
  name: string
  url: string // local object URL — playback never touches the server
  duration: number
  status: 'loading' | 'ready' | 'error'
  upload: { pct: number; state: 'uploading' | 'paused' | 'done' | 'error' }
  waveform?: Float32Array // peak buckets, absent while extracting or if no audio
  thumb?: string // small poster frame as data URL
}

export interface Clip {
  id: string
  mediaId: string
  trackId: TrackId
  start: number // position on timeline (s)
  in: number // trim into source (s)
  out: number
}

export interface Doc {
  clips: Record<string, Clip>
}

export interface Drag {
  clipId: string
  mode: 'move' | 'trim-l' | 'trim-r'
  start: number
  in: number
  out: number
}

export interface State {
  doc: Doc
  history: { past: Doc[]; future: Doc[] } // doc only — scrubbing/selection are never undo steps
  session: {
    playhead: number
    playing: boolean
    selection: string | null
    pxPerSec: number
    drag: Drag | null
    markIn: number | null // range markers for cutting out a middle section
    markOut: number | null
  }
  media: Record<string, Media>
}

export type Action =
  | { type: 'MEDIA_ADDED'; media: Media }
  | { type: 'MEDIA_READY'; id: string; duration: number }
  | { type: 'MEDIA_ERROR'; id: string }
  | { type: 'MEDIA_REMOVED'; id: string } // drops the media and every clip that uses it
  | { type: 'THUMB_READY'; id: string; thumb: string }
  | { type: 'WAVEFORM_READY'; id: string; peaks: Float32Array }
  | { type: 'RESTORED'; doc: Doc; media: Record<string, Media> }
  | { type: 'UPLOAD_PROGRESS'; id: string; pct: number }
  | { type: 'UPLOAD_STATE'; id: string; state: Media['upload']['state'] }
  | { type: 'CLIP_ADDED'; mediaId: string; trackId: TrackId }
  | { type: 'CLIP_REMOVED'; clipId: string }
  | { type: 'SPLIT_AT'; time: number } // razor: selected clip if under the cut, else all clips there
  | { type: 'MARK_IN'; time: number } // range markers live in session — never undo steps
  | { type: 'MARK_OUT'; time: number }
  | { type: 'MARK_CLEARED'; which: 'in' | 'out' }
  | { type: 'MARKS_CLEARED' }
  | { type: 'CUT_RANGE' } // ripple-delete the marked range: trim/drop what's inside, shift what follows
  | { type: 'DRAG_MOVED'; drag: Drag } // ephemeral: writes session only, 1 undo step per gesture
  | { type: 'DRAG_COMMITTED' }
  | { type: 'DRAG_CANCELLED' }
  | { type: 'SEEK'; time: number }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'TICK'; time: number }
  | { type: 'SELECT'; clipId: string | null }
  | { type: 'ZOOM'; pxPerSec: number }
  | { type: 'UNDO' }
  | { type: 'REDO' }

// ---------- selectors ----------

export const clipEnd = (c: Clip) => c.start + (c.out - c.in)

export const docDuration = (doc: Doc) =>
  Object.values(doc.clips).reduce((m, c) => Math.max(m, clipEnd(c)), 0)

/** Clips under the playhead in paint order: bottom track first, top (v1) last. */
export function activeClips(doc: Doc, t: number): Clip[] {
  return [...TRACKS]
    .reverse()
    .flatMap(
      (trackId) =>
        Object.values(doc.clips).find(
          (c) => c.trackId === trackId && t >= c.start && t < clipEnd(c),
        ) ?? [],
    )
}

export const activeClip = (doc: Doc, t: number): Clip | null =>
  activeClips(doc, t).at(-1) ?? null

// ---------- reducer ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

function commit(s: State, doc: Doc): State {
  return { ...s, doc, history: { past: [...s.history.past, s.doc], future: [] } }
}

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'MEDIA_ADDED':
      return { ...s, media: { ...s.media, [a.media.id]: a.media } }

    case 'MEDIA_READY': {
      const m = s.media[a.id]
      if (!m) return s
      return {
        ...s,
        media: { ...s.media, [a.id]: { ...m, duration: a.duration, status: 'ready' } },
      }
    }

    case 'MEDIA_ERROR': {
      const m = s.media[a.id]
      if (!m) return s
      return { ...s, media: { ...s.media, [a.id]: { ...m, status: 'error' } } }
    }

    case 'MEDIA_REMOVED': {
      if (!s.media[a.id]) return s
      const media = { ...s.media }
      delete media[a.id]
      const entries = Object.entries(s.doc.clips).filter(([, c]) => c.mediaId !== a.id)
      // only clip deletion is an undo step; media itself is gone for good
      const next =
        entries.length === Object.keys(s.doc.clips).length
          ? { ...s, media }
          : { ...commit(s, { clips: Object.fromEntries(entries) }), media }
      return {
        ...next,
        session: {
          ...next.session,
          selection:
            next.session.selection && next.doc.clips[next.session.selection]
              ? next.session.selection
              : null,
        },
      }
    }

    case 'THUMB_READY': {
      const m = s.media[a.id]
      if (!m) return s
      return { ...s, media: { ...s.media, [a.id]: { ...m, thumb: a.thumb } } }
    }

    case 'WAVEFORM_READY': {
      const m = s.media[a.id]
      if (!m) return s
      return { ...s, media: { ...s.media, [a.id]: { ...m, waveform: a.peaks } } }
    }

    case 'RESTORED':
      return { ...s, doc: a.doc, media: a.media, history: { past: [], future: [] } }

    case 'UPLOAD_PROGRESS':
    case 'UPLOAD_STATE': {
      const m = s.media[a.id]
      if (!m) return s
      const upload =
        a.type === 'UPLOAD_PROGRESS'
          ? { ...m.upload, pct: a.pct }
          : { ...m.upload, state: a.state }
      return { ...s, media: { ...s.media, [m.id]: { ...m, upload } } }
    }

    case 'CLIP_ADDED': {
      const media = s.media[a.mediaId]
      if (!media || media.status !== 'ready') return s
      const trackEnd = Object.values(s.doc.clips)
        .filter((c) => c.trackId === a.trackId)
        .reduce((m, c) => Math.max(m, clipEnd(c)), 0)
      const clip: Clip = {
        id: crypto.randomUUID(),
        mediaId: a.mediaId,
        trackId: a.trackId,
        start: trackEnd,
        in: 0,
        out: media.duration,
      }
      return commit(s, { clips: { ...s.doc.clips, [clip.id]: clip } })
    }

    case 'CLIP_REMOVED': {
      const clips = { ...s.doc.clips }
      delete clips[a.clipId]
      return {
        ...commit(s, { clips }),
        session: {
          ...s.session,
          selection: s.session.selection === a.clipId ? null : s.session.selection,
        },
      }
    }

    case 'SPLIT_AT': {
      // ignore cuts at the very edge — they'd leave sub-frame slivers
      const under = Object.values(s.doc.clips).filter(
        (c) => c.start + 0.05 < a.time && a.time < clipEnd(c) - 0.05,
      )
      const selected = under.filter((c) => c.id === s.session.selection)
      const targets = selected.length ? selected : under
      if (!targets.length) return s
      const clips = { ...s.doc.clips }
      for (const c of targets) {
        const cut = c.in + (a.time - c.start)
        clips[c.id] = { ...c, out: cut }
        const id = crypto.randomUUID()
        clips[id] = { ...c, id, start: a.time, in: cut }
      }
      return commit(s, { clips })
    }

    case 'MARK_IN':
      return { ...s, session: { ...s.session, markIn: Math.max(0, a.time) } }

    case 'MARK_OUT':
      return { ...s, session: { ...s.session, markOut: Math.max(0, a.time) } }

    case 'MARK_CLEARED':
      return {
        ...s,
        session:
          a.which === 'in' ? { ...s.session, markIn: null } : { ...s.session, markOut: null },
      }

    case 'MARKS_CLEARED':
      return { ...s, session: { ...s.session, markIn: null, markOut: null } }

    case 'CUT_RANGE': {
      const { markIn, markOut } = s.session
      if (markIn === null || markOut === null) return s
      const lo = Math.min(markIn, markOut)
      const hi = Math.max(markIn, markOut)
      // same sliver guard as SPLIT_AT — a cut this narrow only leaves debris
      if (hi - lo < 0.1) return s
      const len = hi - lo
      const clips: Record<string, Clip> = {}
      for (const c of Object.values(s.doc.clips)) {
        const end = clipEnd(c)
        if (end <= lo + 0.05) clips[c.id] = c
        else if (c.start >= hi - 0.05) clips[c.id] = { ...c, start: c.start - len }
        else if (c.start >= lo - 0.05 && end <= hi + 0.05) continue // swallowed by the range
        else if (c.start < lo && end > hi) {
          // straddles the whole range: keep the head, spawn the tail at the seam
          clips[c.id] = { ...c, out: c.in + (lo - c.start) }
          const id = crypto.randomUUID()
          clips[id] = { ...c, id, start: lo, in: c.in + (hi - c.start) }
        } else if (c.start < lo) clips[c.id] = { ...c, out: c.in + (lo - c.start) }
        else clips[c.id] = { ...c, start: lo, in: c.in + (hi - c.start) }
      }
      const next = commit(s, { clips })
      return {
        ...next,
        session: {
          ...next.session,
          markIn: null,
          markOut: null,
          playhead: clamp(lo, 0, docDuration(next.doc)),
          selection:
            next.session.selection && clips[next.session.selection]
              ? next.session.selection
              : null,
        },
      }
    }

    case 'DRAG_MOVED':
      return { ...s, session: { ...s.session, drag: a.drag } }

    case 'DRAG_COMMITTED': {
      const d = s.session.drag
      if (!d) return s
      const clip = s.doc.clips[d.clipId]
      // clip can vanish mid-gesture (Delete while dragging) — drop the ghost
      if (!clip) return { ...s, session: { ...s.session, drag: null } }
      const next = commit(s, {
        clips: { ...s.doc.clips, [d.clipId]: { ...clip, start: d.start, in: d.in, out: d.out } },
      })
      return { ...next, session: { ...next.session, drag: null } }
    }

    case 'DRAG_CANCELLED':
      return { ...s, session: { ...s.session, drag: null } }

    case 'SEEK':
      return {
        ...s,
        session: {
          ...s.session,
          playhead: clamp(a.time, 0, Math.max(docDuration(s.doc), 0)),
        },
      }

    case 'PLAY':
      return docDuration(s.doc) === 0 ? s : { ...s, session: { ...s.session, playing: true } }

    case 'PAUSE':
      return { ...s, session: { ...s.session, playing: false } }

    case 'TICK': {
      const end = docDuration(s.doc)
      if (a.time >= end)
        return { ...s, session: { ...s.session, playhead: end, playing: false } }
      // the first rAF timestamp can predate the engine's t0 — never tick below 0
      return { ...s, session: { ...s.session, playhead: Math.max(0, a.time) } }
    }

    case 'SELECT':
      return { ...s, session: { ...s.session, selection: a.clipId } }

    case 'ZOOM':
      return { ...s, session: { ...s.session, pxPerSec: clamp(a.pxPerSec, 10, 400) } }

    case 'UNDO': {
      const doc = s.history.past.at(-1)
      if (!doc) return s
      return {
        ...s,
        doc,
        history: { past: s.history.past.slice(0, -1), future: [s.doc, ...s.history.future] },
      }
    }

    case 'REDO': {
      const [doc, ...future] = s.history.future
      if (!doc) return s
      return { ...s, doc, history: { past: [...s.history.past, s.doc], future } }
    }
  }
}

// ---------- store ----------

const initial: State = {
  doc: { clips: {} },
  history: { past: [], future: [] },
  session: {
    playhead: 0,
    playing: false,
    selection: null,
    pxPerSec: 60,
    drag: null,
    markIn: null,
    markOut: null,
  },
  media: {},
}

export const useEditor = create<State & { dispatch: (a: Action) => void }>((set) => ({
  ...initial,
  // the single door: views and effects only ever call dispatch
  dispatch: (a) => set((s) => reduce(s, a)),
}))

export const dispatch = (a: Action) => useEditor.getState().dispatch(a)
