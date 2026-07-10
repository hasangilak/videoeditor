import { it, expect } from 'vitest'
import { fmt } from './format'

it('formats mm:ss.d', () => {
  expect(fmt(0)).toBe('00:00.0')
  expect(fmt(7.25)).toBe('00:07.2')
  expect(fmt(61.5)).toBe('01:01.5')
  expect(fmt(600)).toBe('10:00.0')
})
