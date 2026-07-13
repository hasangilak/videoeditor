import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react'
import Transport from './Transport'
import { useEditor } from '@/lib/store'
import { resetStore, seedMedia, seedClip } from '@/lib/test-utils'

beforeEach(() => {
  cleanup()
  resetStore()
  seedMedia()
  seedClip()
})

describe('Transport', () => {
  it('toggles playback', () => {
    render(<Transport />)
    fireEvent.click(screen.getByTitle('Play / pause (space)'))
    expect(useEditor.getState().session.playing).toBe(true)
    fireEvent.click(screen.getByTitle('Play / pause (space)'))
    expect(useEditor.getState().session.playing).toBe(false)
  })

  it('scissors split at the playhead, or at both marks when armed — removing nothing', () => {
    const { dispatch } = useEditor.getState()
    dispatch({ type: 'SEEK', time: 4 })
    render(<Transport />)

    fireEvent.click(screen.getByTitle('Split clip at playhead (S)'))
    expect(Object.keys(useEditor.getState().doc.clips)).toHaveLength(2)

    act(() => {
      dispatch({ type: 'MARK_IN', time: 2 })
      dispatch({ type: 'MARK_OUT', time: 6 })
    })
    fireEvent.click(screen.getByTitle('Split at the I and O lines (S)'))
    const clips = Object.values(useEditor.getState().doc.clips)
    expect(clips).toHaveLength(4) // razored at 2, 4, 6 — every second kept
    expect(clips.reduce((s, c) => s + (c.out - c.in), 0)).toBe(10)
    expect(useEditor.getState().session).toMatchObject({ markIn: null, markOut: null })
  })

  it('cut button removes the marked range, and is disabled until marks are armed', () => {
    const { dispatch } = useEditor.getState()
    render(<Transport />)

    const btn = () =>
      screen.getByTitle('Remove the marked range and close the gap (X) — Esc clears marks')
    expect((btn() as HTMLButtonElement).disabled).toBe(true)

    act(() => {
      dispatch({ type: 'MARK_IN', time: 4 })
      dispatch({ type: 'MARK_OUT', time: 7 })
    })
    expect((btn() as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(btn())
    const clips = Object.values(useEditor.getState().doc.clips)
    expect(clips.reduce((s, c) => s + (c.out - c.in), 0)).toBe(7) // 3s ripple-deleted
    expect(useEditor.getState().session).toMatchObject({ markIn: null, markOut: null })
  })

  it('jumps to start and shows playhead / duration', () => {
    useEditor.getState().dispatch({ type: 'SEEK', time: 7.5 })
    render(<Transport />)
    expect(screen.getByText('00:07.5')).toBeTruthy()
    expect(screen.getByText(/00:10\.0/)).toBeTruthy()

    fireEvent.click(screen.getByTitle('Go to start'))
    expect(useEditor.getState().session.playhead).toBe(0)
  })
})
