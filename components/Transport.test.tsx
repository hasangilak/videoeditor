import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
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

  it('jumps to start and shows playhead / duration', () => {
    useEditor.getState().dispatch({ type: 'SEEK', time: 7.5 })
    render(<Transport />)
    expect(screen.getByText('00:07.5')).toBeTruthy()
    expect(screen.getByText(/00:10\.0/)).toBeTruthy()

    fireEvent.click(screen.getByTitle('Go to start'))
    expect(useEditor.getState().session.playhead).toBe(0)
  })
})
