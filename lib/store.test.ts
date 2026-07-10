import { describe, it, expect, beforeEach } from 'vitest'
import { useEditor, dispatch, docDuration, activeClip, activeClips } from './store'
import { resetStore, seedMedia } from './test-utils'

const state = () => useEditor.getState()

function onlyClipId(): string {
  const id = Object.keys(state().doc.clips)[0]
  if (!id) throw new Error('no clip in doc')
  return id
}

function clipOf(id: string) {
  const c = state().doc.clips[id]
  if (!c) throw new Error(`clip ${id} missing`)
  return c
}

beforeEach(resetStore)

describe('media lifecycle', () => {
  it('tracks import, probe, and upload progress', () => {
    seedMedia({ status: 'loading', duration: 0, upload: { pct: 0, state: 'uploading' } })
    dispatch({ type: 'UPLOAD_PROGRESS', id: 'm1', pct: 40 })
    dispatch({ type: 'MEDIA_READY', id: 'm1', duration: 12 })
    dispatch({ type: 'UPLOAD_STATE', id: 'm1', state: 'paused' })

    const m = state().media.m1
    expect(m).toMatchObject({ status: 'ready', duration: 12, upload: { pct: 40, state: 'paused' } })
  })

  it('marks undecodable media as error', () => {
    seedMedia({ status: 'loading' })
    dispatch({ type: 'MEDIA_ERROR', id: 'm1' })
    dispatch({ type: 'MEDIA_ERROR', id: 'nope' }) // unknown id is a no-op
    expect(state().media.m1?.status).toBe('error')
  })

  it('attaches waveform peaks to existing media only', () => {
    seedMedia()
    const peaks = new Float32Array([0.5, 1])
    dispatch({ type: 'WAVEFORM_READY', id: 'm1', peaks })
    dispatch({ type: 'WAVEFORM_READY', id: 'nope', peaks })
    expect(state().media.m1?.waveform).toBe(peaks)
    expect(Object.keys(state().media)).toEqual(['m1'])
  })

  it('ignores upload actions for unknown media', () => {
    dispatch({ type: 'UPLOAD_PROGRESS', id: 'nope', pct: 50 })
    expect(state().media).toEqual({})
  })
})

describe('clips', () => {
  beforeEach(() => seedMedia())

  it('appends to the end of the target track', () => {
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' })
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' })
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v2' })

    const starts = Object.values(state().doc.clips).map((c) => [c.trackId, c.start])
    expect(starts).toEqual([['v1', 0], ['v1', 10], ['v2', 0]])
    expect(docDuration(state().doc)).toBe(20)
  })

  it('refuses media that is still probing', () => {
    seedMedia({ id: 'm2', status: 'loading' })
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm2', trackId: 'v1' })
    expect(state().doc.clips).toEqual({})
  })

  it('removing a clip clears its selection', () => {
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' })
    const id = onlyClipId()
    dispatch({ type: 'SELECT', clipId: id })
    dispatch({ type: 'CLIP_REMOVED', clipId: id })
    expect(state().doc.clips).toEqual({})
    expect(state().session.selection).toBeNull()
  })
})

describe('drag gesture', () => {
  let id: string
  beforeEach(() => {
    seedMedia()
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' })
    id = onlyClipId()
  })

  const drag = { clipId: '', mode: 'move' as const, start: 5, in: 0, out: 10 }

  it('is ephemeral until committed, then exactly one undo step', () => {
    dispatch({ type: 'DRAG_MOVED', drag: { ...drag, clipId: id } })
    expect(clipOf(id).start).toBe(0) // doc untouched mid-gesture

    dispatch({ type: 'DRAG_COMMITTED' })
    expect(clipOf(id).start).toBe(5)
    expect(state().session.drag).toBeNull()
    expect(state().history.past).toHaveLength(2) // add + move, not one per pointermove
  })

  it('cancelling leaves the doc alone', () => {
    dispatch({ type: 'DRAG_MOVED', drag: { ...drag, clipId: id } })
    dispatch({ type: 'DRAG_CANCELLED' })
    expect(clipOf(id).start).toBe(0)
    expect(state().session.drag).toBeNull()
  })
})

describe('undo/redo', () => {
  it('restores the doc but never the session', () => {
    seedMedia()
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' })
    dispatch({ type: 'SEEK', time: 7 })
    dispatch({ type: 'UNDO' })

    expect(state().doc.clips).toEqual({})
    expect(state().session.playhead).toBe(7)

    dispatch({ type: 'REDO' })
    expect(Object.keys(state().doc.clips)).toHaveLength(1)
  })

  it('is a no-op with empty history', () => {
    const before = state()
    dispatch({ type: 'UNDO' })
    dispatch({ type: 'REDO' })
    expect(state().doc).toBe(before.doc)
  })
})

describe('playback', () => {
  beforeEach(() => {
    seedMedia()
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' })
  })

  it('SEEK clamps into the doc', () => {
    dispatch({ type: 'SEEK', time: -5 })
    expect(state().session.playhead).toBe(0)
    dispatch({ type: 'SEEK', time: 999 })
    expect(state().session.playhead).toBe(10)
  })

  it('TICK stops playback at the doc end', () => {
    dispatch({ type: 'PLAY' })
    dispatch({ type: 'TICK', time: 999 })
    expect(state().session).toMatchObject({ playhead: 10, playing: false })
  })

  it('PLAY is a no-op on an empty timeline', () => {
    resetStore()
    dispatch({ type: 'PLAY' })
    expect(state().session.playing).toBe(false)
  })

  it('ZOOM clamps to sane bounds', () => {
    dispatch({ type: 'ZOOM', pxPerSec: 1 })
    expect(state().session.pxPerSec).toBe(10)
    dispatch({ type: 'ZOOM', pxPerSec: 9999 })
    expect(state().session.pxPerSec).toBe(400)
  })
})

describe('compositor selectors', () => {
  it('paints bottom track first, top track wins', () => {
    seedMedia()
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v2' }) // 0..10 bottom
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' }) // 0..10 top

    const stack = activeClips(state().doc, 5)
    expect(stack.map((c) => c.trackId)).toEqual(['v2', 'v1'])
    expect(activeClip(state().doc, 5)?.trackId).toBe('v1')
    expect(activeClips(state().doc, 15)).toEqual([])
  })
})
