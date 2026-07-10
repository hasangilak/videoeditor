import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UploadOptions } from 'tus-js-client'
import { useEditor } from './store'
import { resetStore } from './test-utils'

// fake tus client: records instances so tests can drive its callbacks
interface FakeUpload {
  file: File
  options: UploadOptions
  started: boolean
  aborted: boolean
}
const tusUploads = vi.hoisted(() => [] as FakeUpload[])
vi.mock('tus-js-client', () => ({
  Upload: class implements FakeUpload {
    started = false
    aborted = false
    constructor(
      public file: File,
      public options: UploadOptions,
    ) {
      tusUploads.push(this)
    }
    start() {
      this.started = true
      this.aborted = false
    }
    abort() {
      this.aborted = true
    }
    findPreviousUploads() {
      return Promise.resolve([])
    }
    resumeFromPreviousUpload() {}
  },
}))

import { importFiles, pauseUpload, resumeUpload } from './media'

const state = () => useEditor.getState()

function lastUpload(): FakeUpload {
  const u = tusUploads.at(-1)
  if (!u) throw new Error('no tus upload was created')
  return u
}

function mediaOf(id: string) {
  const m = state().media[id]
  if (!m) throw new Error(`media ${id} not in store`)
  return m
}

// jsdom has neither object URLs nor real video decoding
URL.createObjectURL = vi.fn(() => 'blob:mock')
const probes: HTMLVideoElement[] = []
const realCreate = document.createElement.bind(document)
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  const el = realCreate(tag)
  if (tag === 'video') probes.push(el as HTMLVideoElement)
  return el
})

beforeEach(() => {
  resetStore()
  tusUploads.length = 0
  probes.length = 0
})

function importOne(): string {
  importFiles([new File(['x'], 'clip.mp4', { type: 'video/mp4' })])
  const id = Object.keys(state().media)[0]
  if (!id) throw new Error('import registered no media')
  return id
}

describe('importFiles', () => {
  it('registers media immediately with a local object URL', () => {
    const id = importOne()
    expect(mediaOf(id)).toMatchObject({
      name: 'clip.mp4',
      url: 'blob:mock',
      status: 'loading',
      upload: { pct: 0, state: 'uploading' },
    })
  })

  it('marks media as error when the probe cannot decode it', () => {
    // drain probes left pending by earlier tests so counts are deterministic
    document.dispatchEvent(new Event('visibilitychange'))
    for (const p of probes) {
      Object.defineProperty(p, 'duration', { value: 1, configurable: true })
      p.onloadedmetadata?.(new Event('loadedmetadata'))
    }
    probes.length = 0

    const id = importOne()
    const probe = probes[0]
    if (!probe) throw new Error('no probe element created')
    probe.onerror!(new Event('error'))
    expect(mediaOf(id).status).toBe('error')
    // resolved as error — visibility flips must not re-probe it
    const before = probes.length
    document.dispatchEvent(new Event('visibilitychange'))
    expect(probes.length).toBe(before)
  })

  it('marks media ready when the browser probe reports duration', () => {
    const id = importOne()
    const probe = probes[0]
    if (!probe) throw new Error('no probe element created')
    Object.defineProperty(probe, 'duration', { value: 42 })
    probe.onloadedmetadata!(new Event('loadedmetadata'))
    expect(mediaOf(id)).toMatchObject({ status: 'ready', duration: 42 })
  })

  it('starts a resumable chunked tus upload and reports progress', async () => {
    const id = importOne()
    const up = lastUpload()
    expect(up.options).toMatchObject({
      endpoint: '/api/tus',
      chunkSize: 64 * 1024 * 1024,
      storeFingerprintForResuming: true,
    })
    await vi.waitFor(() => expect(up.started).toBe(true))

    up.options.onProgress!(50, 200)
    expect(mediaOf(id).upload).toMatchObject({ pct: 25, state: 'uploading' })

    up.options.onSuccess!({ lastResponse: null! })
    expect(mediaOf(id).upload.state).toBe('done')
  })

  it('re-probes still-loading media when the tab becomes visible', () => {
    const id = importOne() // first probe deferred (e.g. hidden tab), never resolves
    const before = probes.length

    document.dispatchEvent(new Event('visibilitychange')) // jsdom is always 'visible'
    const retries = probes.slice(before)
    expect(retries.length).toBeGreaterThanOrEqual(1)

    // resolve every retry — MEDIA_READY for media of other tests is a no-op
    for (const retry of retries) {
      Object.defineProperty(retry, 'duration', { value: 9 })
      retry.onloadedmetadata!(new Event('loadedmetadata'))
    }
    expect(mediaOf(id)).toMatchObject({ status: 'ready', duration: 9 })

    // all resolved — a later visibility flip must not spawn more probes
    const after = probes.length
    document.dispatchEvent(new Event('visibilitychange'))
    expect(probes).toHaveLength(after)
  })

  it('surfaces upload failure', () => {
    const id = importOne()
    lastUpload().options.onError!(new Error('boom'))
    expect(mediaOf(id).upload.state).toBe('error')
  })
})

describe('pause/resume', () => {
  it('maps to tus abort/start and updates state', async () => {
    const id = importOne()
    const up = lastUpload()
    await vi.waitFor(() => expect(up.started).toBe(true))

    pauseUpload(id)
    expect(up.aborted).toBe(true)
    expect(mediaOf(id).upload.state).toBe('paused')

    resumeUpload(id)
    expect(up.aborted).toBe(false)
    expect(mediaOf(id).upload.state).toBe('uploading')
  })
})
