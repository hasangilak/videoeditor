import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import UploadTray from './UploadTray'
import { resetStore, seedMedia } from '@/lib/test-utils'

vi.mock('@/lib/media', () => ({ pauseUpload: vi.fn(), resumeUpload: vi.fn() }))
import { pauseUpload, resumeUpload } from '@/lib/media'

beforeEach(() => {
  cleanup()
  resetStore()
  vi.clearAllMocks()
})

describe('UploadTray', () => {
  it('is hidden when nothing is uploading', () => {
    seedMedia() // upload done
    const { container } = render(<UploadTray />)
    expect(container.firstChild).toBeNull()
  })

  it('shows active uploads with pause control', () => {
    seedMedia({ upload: { pct: 30, state: 'uploading' } })
    render(<UploadTray />)
    expect(screen.getByText('a.mp4')).toBeTruthy()
    fireEvent.click(screen.getByText('Pause'))
    expect(pauseUpload).toHaveBeenCalledWith('m1')
  })

  it('offers resume when paused and retry on error', () => {
    seedMedia({ upload: { pct: 30, state: 'paused' } })
    seedMedia({ id: 'm2', name: 'b.mp4', upload: { pct: 10, state: 'error' } })
    render(<UploadTray />)

    fireEvent.click(screen.getByText('Resume'))
    expect(resumeUpload).toHaveBeenCalledWith('m1')
    fireEvent.click(screen.getByText('Retry'))
    expect(resumeUpload).toHaveBeenCalledWith('m2')
  })
})
