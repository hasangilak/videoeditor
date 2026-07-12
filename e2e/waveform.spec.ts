import { test, expect, clips, litPixels } from './helpers'
import type { Page } from '@playwright/test'

// like makeWebm in helpers, but with a real audio track (oscillator)
async function makeWebmWithAudio(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 180
    const ctx = c.getContext('2d')!
    const ac = new AudioContext()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    gain.gain.value = 0.0
    // pulse the volume so the waveform has a visible envelope
    for (let t = 0; t < 5; t += 0.5) {
      gain.gain.setValueAtTime(0.05, ac.currentTime + t)
      gain.gain.linearRampToValueAtTime(0.9, ac.currentTime + t + 0.25)
      gain.gain.linearRampToValueAtTime(0.05, ac.currentTime + t + 0.5)
    }
    const dest = ac.createMediaStreamDestination()
    osc.connect(gain).connect(dest)
    osc.start()
    const stream = new MediaStream([
      ...c.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ])
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.start()
    const t0 = performance.now()
    await new Promise<void>((res) => {
      const tick = (now: number) => {
        const t = (now - t0) / 1000
        ctx.fillStyle = `hsl(${(t * 60) % 360} 70% 45%)`
        ctx.fillRect(0, 0, 320, 180)
        if (t > 4) {
          rec.onstop = () => res()
          rec.stop()
          osc.stop()
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const buf = await new Blob(chunks).arrayBuffer()
    const bytes = new Uint8Array(buf)
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  })
  return Buffer.from(b64, 'base64')
}

test('clip shows a waveform for media with audio', async ({ page }) => {
  await page.goto('/')
  const buffer = await makeWebmWithAudio(page)
  await page.setInputFiles('input[type=file]', {
    name: 'audio.webm',
    mimeType: 'video/webm',
    buffer,
  })
  await expect(page.getByRole('button', { name: '+ V1' })).toBeEnabled({ timeout: 15_000 })
  await page.getByRole('button', { name: '+ V1' }).click()
  await expect(clips(page)).toHaveCount(1)
  await expect(clips(page).first().locator('canvas')).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => litPixels(page, '[data-clip] canvas')).toBeGreaterThan(500)
})
