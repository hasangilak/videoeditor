// @vitest-environment node
// Drives the real route handlers with fetch Requests — create, upload, verify offset.
import { describe, it, expect, afterAll } from 'vitest'
import { rmSync } from 'node:fs'
import { POST, PATCH, HEAD } from '@/app/api/tus/[[...file]]/route'

const created: string[] = []
afterAll(() =>
  created.forEach((id) => {
    rmSync(`uploads/${id}`, { force: true })
    rmSync(`uploads/${id}.json`, { force: true })
  }),
)

describe('tus mock backend', () => {
  it('accepts a full create → patch → head cycle', async () => {
    const create = await POST(
      new Request('http://localhost/api/tus', {
        method: 'POST',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': '5',
          'Upload-Metadata': 'filename dGVzdC5tcDQ=',
        },
      }),
    )
    expect(create.status).toBe(201)
    const location = create.headers.get('location')!
    expect(location).toContain('/api/tus/')
    created.push(location.split('/').pop()!)

    const patch = await PATCH(
      new Request(location, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': '0',
          'Content-Type': 'application/offset+octet-stream',
        },
        body: 'hello',
      }),
    )
    expect(patch.status).toBe(204)
    expect(patch.headers.get('upload-offset')).toBe('5')

    const head = await HEAD(
      new Request(location, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } }),
    )
    expect(head.headers.get('upload-offset')).toBe('5')
    expect(head.headers.get('upload-length')).toBe('5')
  })

  it('rejects requests without the tus version header', async () => {
    const res = await POST(
      new Request('http://localhost/api/tus', {
        method: 'POST',
        headers: { 'Upload-Length': '5' },
      }),
    )
    expect(res.status).toBe(412)
  })
})
