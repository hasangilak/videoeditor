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

test('hovering the timeline shows a frame preview with a timecode', async ({ page }) => {
  await importVideo(page)
  await addClip(page)
  const clip = clips(page).first()
  const box = (await clip.boundingBox())!
  await page.mouse.move(box.x + 90, box.y + box.height / 2)
  const thumb = page.getByTestId('hover-thumb')
  await expect(thumb).toBeVisible()
  await expect(thumb.getByText(/\d\d:\d\d\.\d/)).toBeVisible()
  // the hidden scrub video needs a moment to seek before the frame is drawn
  await expect.poll(() => litPixels(page, '[data-testid=hover-thumb] canvas')).toBeGreaterThan(1000)
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
  test.setTimeout(60_000) // export is realtime: it plays the 4s doc through
  await importVideo(page)
  await addClip(page)
  const download = page.waitForEvent('download', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Export' }).click()
  expect((await download).suggestedFilename()).toBe('export.webm')
})

test('the library page lists imports; the editor hides the nav', async ({ page }) => {
  await importVideo(page)
  await expect(page.locator('nav')).toHaveCount(0)
  await page.getByTitle('Library').click()
  await expect(page.getByText('smoke.webm')).toBeVisible()
  await expect(page.getByText(/00:0\d\.\d · /)).toBeVisible()
})
