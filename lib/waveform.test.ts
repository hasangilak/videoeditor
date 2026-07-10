import { describe, it, expect } from 'vitest'
import { bucketPeaks, drawWaveform } from './waveform'

describe('bucketPeaks', () => {
  it('keeps the max absolute amplitude per bucket', () => {
    const ch = new Float32Array([0, 0.2, 1, 0, -0.5, 0, 0.1, 0])
    expect(Array.from(bucketPeaks([ch], 2))).toEqual([1, 0.5]) // |-0.5| counts
  })

  it('takes the loudest channel', () => {
    const a = new Float32Array([0.125, 0.125])
    const b = new Float32Array([0.75, 0.25])
    expect(Array.from(bucketPeaks([a, b], 1))).toEqual([0.75])
  })

  it('handles more buckets than samples without gaps', () => {
    const peaks = bucketPeaks([new Float32Array([0.5, 1])], 4)
    expect(peaks).toHaveLength(4)
    expect(Math.max(...peaks)).toBe(1)
  })

  it('returns silence for no channels', () => {
    expect(Array.from(bucketPeaks([], 3))).toEqual([0, 0, 0])
  })
})

describe('drawWaveform', () => {
  it('is a safe no-op without a 2d context or peaks', () => {
    const canvas = document.createElement('canvas') // jsdom: getContext → null
    drawWaveform(canvas, new Float32Array([1, 0.5]))
    drawWaveform(canvas, new Float32Array(0), { from: 0.2, to: 0.8 })
  })
})
