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

  it('marks undecodable media as error and attaches thumbnails', () => {
    seedMedia({ status: 'loading' })
    dispatch({ type: 'THUMB_READY', id: 'm1', thumb: 'data:image/jpeg;base64,x' })
    dispatch({ type: 'MEDIA_ERROR', id: 'm1' })
    dispatch({ type: 'MEDIA_ERROR', id: 'nope' }) // unknown id is a no-op
    expect(state().media.m1).toMatchObject({ status: 'error', thumb: 'data:image/jpeg;base64,x' })
  })

  it('RESTORED replaces doc and media with empty history', () => {
    seedMedia()
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' })
    const doc = state().doc
    const media = state().media
    resetStore()
    dispatch({ type: 'RESTORED', doc, media })
    expect(state().doc).toBe(doc)
    expect(state().media).toBe(media)
    expect(state().history.past).toHaveLength(0)
  })

  it('MEDIA_REMOVED drops the media, its clips, and a dangling selection', () => {
    seedMedia()
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' })
    dispatch({ type: 'SELECT', clipId: onlyClipId() })
    dispatch({ type: 'MEDIA_REMOVED', id: 'm1' })
    expect(state().media.m1).toBeUndefined()
    expect(state().doc.clips).toEqual({})
    expect(state().session.selection).toBeNull()
    dispatch({ type: 'MEDIA_REMOVED', id: 'nope' }) // unknown id is a no-op
    expect(state().history.past.length).toBeGreaterThan(0) // clip removal is undoable
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

describe('split', () => {
  beforeEach(() => {
    seedMedia()
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' }) // 0..10
  })

  it('cuts the clip under the playhead into two continuous clips, one undo step', () => {
    dispatch({ type: 'SPLIT_AT', time: 4 })
    const clips = Object.values(state().doc.clips).sort((a, b) => a.start - b.start)
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ start: 0, in: 0, out: 4 })
    expect(clips[1]).toMatchObject({ start: 4, in: 4, out: 10 })

    dispatch({ type: 'UNDO' })
    expect(Object.values(state().doc.clips)).toHaveLength(1)
  })

  it('no-ops at clip edges and in empty timeline space', () => {
    dispatch({ type: 'SPLIT_AT', time: 0 })
    dispatch({ type: 'SPLIT_AT', time: 10 })
    dispatch({ type: 'SPLIT_AT', time: 25 })
    expect(Object.values(state().doc.clips)).toHaveLength(1)
  })

  it('cuts only the selected clip when the cut crosses several', () => {
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v2' }) // also 0..10
    const v2 = Object.values(state().doc.clips).find((c) => c.trackId === 'v2')!
    dispatch({ type: 'SELECT', clipId: v2.id })
    dispatch({ type: 'SPLIT_AT', time: 5 })

    const byTrack = (t: string) =>
      Object.values(state().doc.clips).filter((c) => c.trackId === t)
    expect(byTrack('v2')).toHaveLength(2)
    expect(byTrack('v1')).toHaveLength(1) // untouched
  })
})

describe('cut range', () => {
  beforeEach(() => {
    seedMedia()
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v1' }) // 0..10
  })

  const mark = (a: number, b: number) => {
    dispatch({ type: 'MARK_IN', time: a })
    dispatch({ type: 'MARK_OUT', time: b })
  }

  it('cuts a middle section out of one clip and joins the ends, one undo step', () => {
    mark(4, 7)
    const before = state().history.past.length
    dispatch({ type: 'CUT_RANGE' })

    const clips = Object.values(state().doc.clips).sort((a, b) => a.start - b.start)
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ start: 0, in: 0, out: 4 })
    expect(clips[1]).toMatchObject({ start: 4, in: 7, out: 10 })
    expect(docDuration(state().doc)).toBe(7)
    expect(state().history.past).toHaveLength(before + 1)

    dispatch({ type: 'UNDO' })
    expect(Object.values(state().doc.clips)).toHaveLength(1)
  })

  it('clears marks, reseats the playhead, and drops a swallowed selection', () => {
    dispatch({ type: 'SPLIT_AT', time: 4 })
    dispatch({ type: 'SPLIT_AT', time: 7 })
    const middle = Object.values(state().doc.clips).find((c) => c.start === 4)!
    dispatch({ type: 'SELECT', clipId: middle.id })
    dispatch({ type: 'SEEK', time: 9 })
    mark(4, 7)
    dispatch({ type: 'CUT_RANGE' })

    const clips = Object.values(state().doc.clips).sort((a, b) => a.start - b.start)
    expect(clips).toHaveLength(2) // middle segment swallowed, tail rippled left
    expect(clips[1]).toMatchObject({ start: 4, in: 7, out: 10 })
    expect(state().session).toMatchObject({
      markIn: null,
      markOut: null,
      playhead: 4,
      selection: null,
    })
  })

  it('trims clips that only overlap one edge of the range', () => {
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v2' }) // 0..10
    dispatch({
      type: 'DRAG_MOVED',
      drag: {
        clipId: Object.values(state().doc.clips).find((c) => c.trackId === 'v2')!.id,
        mode: 'move',
        start: 9,
        in: 0,
        out: 10,
      },
    })
    dispatch({ type: 'DRAG_COMMITTED' }) // v2 clip now 9..19
    mark(8, 12)
    dispatch({ type: 'CUT_RANGE' })

    const v1 = Object.values(state().doc.clips).filter((c) => c.trackId === 'v1')
    const v2 = Object.values(state().doc.clips).filter((c) => c.trackId === 'v2')
    expect(v1).toHaveLength(1)
    expect(v1[0]).toMatchObject({ start: 0, in: 0, out: 8 }) // tail inside the range trimmed off
    expect(v2).toHaveLength(1)
    expect(v2[0]).toMatchObject({ start: 8, in: 3, out: 10 }) // head trimmed, pulled up to the seam
  })

  it('splits a clip that straddles the whole range and closes the gap', () => {
    dispatch({ type: 'CLIP_ADDED', mediaId: 'm1', trackId: 'v2' }) // 0..10
    mark(3, 6)
    dispatch({ type: 'CUT_RANGE' })

    for (const track of ['v1', 'v2'] as const) {
      const clips = Object.values(state().doc.clips)
        .filter((c) => c.trackId === track)
        .sort((a, b) => a.start - b.start)
      expect(clips).toHaveLength(2)
      expect(clips[0]).toMatchObject({ start: 0, in: 0, out: 3 })
      expect(clips[1]).toMatchObject({ start: 3, in: 6, out: 10 })
    }
  })

  it('clears one mark without touching the other', () => {
    mark(2, 5)
    dispatch({ type: 'MARK_CLEARED', which: 'in' })
    expect(state().session).toMatchObject({ markIn: null, markOut: 5 })
    dispatch({ type: 'MARK_CLEARED', which: 'out' })
    expect(state().session).toMatchObject({ markIn: null, markOut: null })
    dispatch({ type: 'CUT_RANGE' }) // cleared marks mean nothing to cut
    expect(Object.values(state().doc.clips)).toHaveLength(1)
  })

  it('accepts reversed marks and refuses slivers or missing marks', () => {
    dispatch({ type: 'CUT_RANGE' }) // no marks
    dispatch({ type: 'MARK_IN', time: 4 })
    dispatch({ type: 'CUT_RANGE' }) // no out mark
    mark(4, 4.05)
    dispatch({ type: 'CUT_RANGE' }) // sliver
    expect(Object.values(state().doc.clips)).toHaveLength(1)

    mark(7, 4) // out before in still cuts 4..7
    dispatch({ type: 'CUT_RANGE' })
    expect(docDuration(state().doc)).toBe(7)
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
