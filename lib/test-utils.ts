import { useEditor, type Media, type Clip } from './store'

export function resetStore() {
  useEditor.setState({
    doc: { clips: {} },
    history: { past: [], future: [] },
    session: { playhead: 0, playing: false, selection: null, pxPerSec: 60, drag: null },
    media: {},
  })
}

export function seedMedia(over: Partial<Media> = {}): Media {
  const m: Media = {
    id: 'm1',
    name: 'a.mp4',
    url: 'blob:mock',
    duration: 10,
    status: 'ready',
    upload: { pct: 100, state: 'done' },
    ...over,
  }
  useEditor.setState((s) => ({ media: { ...s.media, [m.id]: m } }))
  return m
}

export function seedClip(over: Partial<Clip> = {}): Clip {
  const c: Clip = { id: 'c1', mediaId: 'm1', trackId: 'v1', start: 0, in: 0, out: 10, ...over }
  useEditor.setState((s) => ({ doc: { clips: { ...s.doc.clips, [c.id]: c } } }))
  return c
}
