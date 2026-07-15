import { test, expect, importVideo, addClip, clips, playheadSeconds, seekTo, litPixels } from './helpers'

test('import shows the media with duration, thumbnail, and finished upload', async ({ page }) => {
  await importVideo(page)
  const bin = page.locator('aside')
  await expect(bin.getByText('smoke.webm')).toBeVisible()
  await expect(bin.getByText(/00:0[3-9]\.\d/)).toBeVisible() // probed duration
  await expect(bin.locator('img')).toBeVisible() // poster thumbnail
  await expect(bin.getByText('uploaded')).toBeVisible({ timeout: 15_000 }) // tus done
})

test('clips land on both tracks and the transport shows the doc duration', async ({ page }) => {
  await importVideo(page)
  await addClip(page, 'V1')
  await addClip(page, 'V2')
  await expect(clips(page)).toHaveCount(2)
  const [num, den] = (await page.getByTestId('timecode').innerText()).split('/')
  expect(num).toContain('00:00.0')
  expect(den).toMatch(/00:0[3-9]\.\d/)
})

test('play advances the playhead, pause freezes it, space toggles both', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  const playPause = page.getByTitle('Play / pause (space)')

  await playPause.click()
  await expect.poll(() => playheadSeconds(page)).toBeGreaterThan(0.2)
  await playPause.click()
  const frozen = await playheadSeconds(page)
  await page.waitForTimeout(400)
  expect(await playheadSeconds(page)).toBe(frozen)

  await page.keyboard.press('Space')
  await expect.poll(() => playheadSeconds(page)).toBeGreaterThan(frozen)
  await page.keyboard.press('Space')

  // go-to-start button rewinds
  await page.getByTitle('Go to start').click()
  expect(await playheadSeconds(page)).toBe(0)
})

test('clicking the ruler seeks and the preview renders that frame', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  await seekTo(page, 2)
  expect(await playheadSeconds(page)).toBeCloseTo(2, 0)
  // the compositor should paint a non-black frame at the new time
  await expect.poll(() => litPixels(page, '#preview-canvas')).toBeGreaterThan(1000)
})

test('hovering the ruler shows a frame preview with a timecode', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  const ruler = page.locator('.cursor-col-resize')
  const box = (await ruler.boundingBox())!
  await page.mouse.move(box.x + 90, box.y + box.height / 2)
  const thumb = page.getByTestId('hover-thumb')
  await expect(thumb).toBeVisible()
  await expect(thumb.getByText(/\d\d:\d\d\.\d/)).toBeVisible()
  // the hidden scrub video needs a moment to seek before the frame is drawn
  await expect.poll(() => litPixels(page, '[data-testid=hover-thumb] canvas')).toBeGreaterThan(1000)

  // hovering the track area (off the ruler) must not show the preview
  const clipBox = (await clips(page).first().boundingBox())!
  await page.mouse.move(clipBox.x + 90, clipBox.y + clipBox.height / 2)
  await expect(thumb).toBeHidden()
})

test('split at the playhead, then undo and redo', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  const whole = (await clips(page).first().boundingBox())!
  await seekTo(page, 2)
  await page.keyboard.press('s')
  await expect(clips(page)).toHaveCount(2)

  // the two halves cover exactly the original span
  const boxes = await Promise.all([clips(page).nth(0).boundingBox(), clips(page).nth(1).boundingBox()])
  expect(boxes[0]!.width + boxes[1]!.width).toBeCloseTo(whole.width, 0)

  await page.getByTitle('Undo (⌘Z)').click()
  await expect(clips(page)).toHaveCount(1)
  await page.getByTitle('Redo (⇧⌘Z)').click()
  await expect(clips(page)).toHaveCount(2)
})

test('mark in/out then cut removes the middle and closes the gap', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  const whole = (await clips(page).first().boundingBox())!

  await seekTo(page, 1)
  await page.keyboard.press('i')
  await seekTo(page, 2)
  await page.keyboard.press('o')
  await expect(page.getByTestId('cut-range')).toBeVisible()
  const range = (await page.getByTestId('cut-range').boundingBox())!
  expect(range.width).toBeCloseTo(60, -1) // 1 s at 60 px/s

  await page.getByRole('button', { name: '✂ Remove' }).click()
  await expect(clips(page)).toHaveCount(2)
  await expect(page.getByTestId('cut-range')).toBeHidden()

  // the remaining halves cover the original span minus the cut second
  const boxes = await Promise.all([clips(page).nth(0).boundingBox(), clips(page).nth(1).boundingBox()])
  expect(boxes[0]!.width + boxes[1]!.width).toBeCloseTo(whole.width - 60, -1)
  expect(await playheadSeconds(page)).toBeCloseTo(1, 0)

  await page.getByTitle('Undo (⌘Z)').click()
  await expect(clips(page)).toHaveCount(1)
})

test('pressing I marks at the hovered time, not the playhead', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  // playhead stays at 0; hover the ruler at 2s and press I
  const ruler = page.locator('.cursor-col-resize')
  const box = (await ruler.boundingBox())!
  await page.mouse.move(box.x + 120, box.y + box.height / 2)
  await page.keyboard.press('i')

  const flag = (await page.getByTestId('mark-i').boundingBox())!
  // the I flag hangs left of its line, so its right edge sits at the mark
  expect(flag.x + flag.width - box.x).toBeCloseTo(120, -1)
  expect(await playheadSeconds(page)).toBe(0)

  // away from the timeline the key falls back to the playhead
  await page.mouse.move(box.x + 300, 10) // over the preview, off the timeline
  await page.keyboard.press('i')
  const moved = (await page.getByTestId('mark-i').boundingBox())!
  expect(moved.x + moved.width - box.x).toBeCloseTo(0, -1)
})

test('pressing I after scrolling the timeline marks under the cursor, not the stale hover', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  // zoom until the timeline overflows the viewport so it can actually scroll
  const zoomIn = page.getByRole('button', { name: '+', exact: true })
  await zoomIn.click()
  await zoomIn.click()
  await zoomIn.click()

  const ruler = page.locator('.cursor-col-resize')
  const box = (await ruler.boundingBox())!
  const cursorX = box.x + 200
  await page.mouse.move(cursorX, box.y + box.height / 2)
  // trackpad-scroll the timeline under the stationary cursor — no pointermove fires
  await page.mouse.wheel(150, 0)
  const scroller = page.locator('.overflow-x-auto')
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100)
  await page.keyboard.press('i')

  // the I flag hangs left of its line, so its right edge sits under the cursor
  const flag = (await page.getByTestId('mark-i').boundingBox())!
  expect(flag.x + flag.width).toBeCloseTo(cursorX, -1)
})

test('marks deactivate via a click on the flag or the transport toggle', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  await seekTo(page, 1)
  await page.keyboard.press('i')
  await seekTo(page, 2.5)
  await page.keyboard.press('o')
  await expect(page.getByTestId('cut-range')).toBeVisible()

  // clicking the I flag (no drag) removes just that mark
  await page.getByTestId('mark-i').click()
  await expect(page.getByTestId('mark-i')).toBeHidden()
  await expect(page.getByTestId('cut-range')).toBeHidden()
  await expect(page.getByTestId('mark-o')).toBeVisible()

  // the lit O button in the transport toggles its mark off
  await page.getByTitle('Clear cut end').click()
  await expect(page.getByTestId('mark-o')).toBeHidden()
  await expect(page.getByTitle('Mark cut end at playhead (O)')).toBeVisible()
})

test('dragging a clip moves it along the track', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  const clip = clips(page).first()
  const box = (await clip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  const moved = (await clip.boundingBox())!
  expect(moved.x - box.x).toBeCloseTo(120, -1) // 120 px = 2 s at 60 px/s
})

test('the › handle trims the clip end', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  const clip = clips(page).first()
  await clip.click() // select → handles show
  const box = (await clip.boundingBox())!
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 68, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  const trimmed = (await clip.boundingBox())!
  expect(box.width - trimmed.width).toBeCloseTo(60, -1)
})

test('delete removes the selected clip', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  await clips(page).first().click()
  await page.keyboard.press('Delete')
  await expect(clips(page)).toHaveCount(0)
})

test('the × button on a selected clip removes it', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  const clip = clips(page).first()
  await clip.click() // select — the button becomes visible
  await clip.getByTitle('Remove clip (Delete)').click()
  await expect(clips(page)).toHaveCount(0)
})

test('zoom buttons rescale the timeline', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  const before = (await clips(page).first().boundingBox())!
  await expect(page.getByText('60 px/s')).toBeVisible()
  await page.getByRole('button', { name: '+', exact: true }).click()
  await expect(page.getByText('90 px/s')).toBeVisible()
  const after = (await clips(page).first().boundingBox())!
  expect(after.width / before.width).toBeCloseTo(1.5, 1)
})

test('removing an import clears the bin and its clips', async ({ page }) => {
  await importVideo(page)
  await addClip(page, 'V1')
  await addClip(page, 'V2')
  await page.locator('aside').getByText('smoke.webm').hover()
  await page.getByTitle('Remove import (also removes its clips)').click()
  await expect(clips(page)).toHaveCount(0)
  await expect(page.getByText('Drop video files here')).toBeVisible()
})

test('the project survives a reload', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  await page.waitForTimeout(800) // autosave debounce + IndexedDB write
  await page.reload()
  await expect(clips(page)).toHaveCount(1)
  await expect(page.locator('aside').getByText('smoke.webm')).toBeVisible()
})

test('export downloads a webm of the timeline', async ({ page }) => {
  test.setTimeout(60_000)
  await importVideo(page)
  await addClip(page)
  const download = page.waitForEvent('download', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('export.webm')
})

test('export with a clip selected downloads only that clip', async ({ page }) => {
  test.setTimeout(60_000)
  await importVideo(page)
  await addClip(page)
  const total = await page
    .getByTestId('timecode')
    .innerText()
    .then((t) => {
      const m = t.split('/')[1]!.match(/(\d+):(\d+)\.(\d)/)!
      return +m[1]! * 60 + +m[2]! + +m[3]! / 10
    })

  await seekTo(page, 2)
  await page.keyboard.press('s')
  await expect(clips(page)).toHaveCount(2)

  // selecting the second piece scopes the export to it
  await clips(page).nth(1).click()
  const download = page.waitForEvent('download', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Export clip' }).click()
  const path = await (await download).path()

  // load the exported file back into the page: check its duration and that its
  // first frame shows the source at 2s, not 0s (the test video's background hue
  // is t*60°, so a green-ish start means the export began at the split)
  const b64 = (await import('node:fs')).readFileSync(path).toString('base64')
  const { duration, px } = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const v = document.createElement('video')
    v.muted = true
    v.src = url
    await new Promise((res, rej) => {
      v.onloadedmetadata = res
      v.onerror = () => rej(new Error('exported webm failed to decode'))
    })
    // a streamed webm can report Infinity until forced to scan to the end
    if (!isFinite(v.duration)) {
      v.currentTime = 1e6
      await new Promise((res) => (v.ondurationchange = res))
    }
    const duration = v.duration
    v.currentTime = 0.05
    await new Promise((res) => (v.onseeked = res))
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(v, 0, 0)
    // sample inside the letterboxed image, clear of the white timestamp text
    const px = [...ctx.getImageData(c.width / 2, c.height * 0.15, 1, 1).data.slice(0, 3)]
    URL.revokeObjectURL(url)
    return { duration, px }
  }, b64)
  expect(duration).toBeCloseTo(total - 2, 0) // the piece from the 2s split to the end
  expect(px[1]!).toBeGreaterThan(px[0]!) // hue ≈120° (green) at 2s; 0s would be red
})

test('the library page lists imports; the editor hides the nav', async ({ page }) => {
  await importVideo(page)
  await expect(page.locator('nav')).toHaveCount(0)
  await page.getByTitle('Library').click()
  // scope to the library grid — mid-transition the editor's media bin still holds the same name
  await expect(page.locator('main').getByText('smoke.webm')).toBeVisible()
  await expect(page.locator('main').getByText(/00:0\d\.\d · /)).toBeVisible()
})
