import { test as base, expect, type Page } from '@playwright/test'

/** Fail any test in which the page threw an uncaught exception. */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await use(errors)
      expect(errors, 'uncaught page errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

// The suite needs a real decodable video. Encoding one in Node needs ffmpeg,
// so render a 4s webm in the browser itself (canvas.captureStream +
// MediaRecorder) — recording is realtime, so cache it per worker process.
let cached: Buffer | undefined

async function makeWebm(page: Page): Promise<Buffer> {
  if (cached) return cached
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 180
    const ctx = c.getContext('2d')!
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.start()
    const t0 = performance.now()
    await new Promise<void>((res) => {
      const tick = (now: number) => {
        const t = (now - t0) / 1000
        ctx.fillStyle = `hsl(${(t * 60) % 360} 70% 45%)`
        ctx.fillRect(0, 0, 320, 180)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 40px monospace'
        ctx.fillText(t.toFixed(1), 120, 100)
        if (t > 4) {
          rec.onstop = () => res()
          rec.stop()
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const buf = await new Blob(chunks).arrayBuffer()
    const bytes = new Uint8Array(buf)
    let s = ''
    // chunked — spreading the whole buffer into fromCharCode overflows the stack
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  })
  cached = Buffer.from(b64, 'base64')
  return cached
}

/** Open the editor and import the generated test video via the file input. */
export async function importVideo(page: Page) {
  await page.goto('/')
  const buffer = await makeWebm(page)
  await page.setInputFiles('input[type=file]', {
    name: 'smoke.webm',
    mimeType: 'video/webm',
    buffer,
  })
  // media is usable once the probe finished and the add-to-track buttons enable
  await expect(page.getByRole('button', { name: '+ V1' })).toBeEnabled({ timeout: 15_000 })
}

export const clips = (page: Page) => page.locator('[data-clip]')

export async function addClip(page: Page, track: 'V1' | 'V2' = 'V1') {
  await page.getByRole('button', { name: `+ ${track}` }).click()
}

/** Current playhead position in seconds, read from the transport timecode. */
export async function playheadSeconds(page: Page) {
  const txt = await page.getByTestId('timecode').locator('span').first().innerText()
  const m = txt.match(/(\d+):(\d+)\.(\d)/)
  if (!m) throw new Error(`unparsable timecode: ${txt}`)
  return +m[1]! * 60 + +m[2]! + +m[3]! / 10
}

/** Seek by clicking the ruler at `seconds` (default zoom is 60 px/s). */
export async function seekTo(page: Page, seconds: number) {
  const ruler = page.locator('.cursor-col-resize')
  const box = (await ruler.boundingBox())!
  await page.mouse.click(box.x + seconds * 60, box.y + box.height / 2)
}

/** Count canvas pixels brighter than near-black. */
export function litPixels(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement | null
    if (!c) return 0
    const ctx = c.getContext('2d')
    if (!ctx) return 0
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 30) n++
    return n
  }, selector)
}
