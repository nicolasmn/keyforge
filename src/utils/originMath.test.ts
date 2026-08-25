import { describe, it, expect } from 'vitest'
import { isValidOriginTrackValue, ORIGIN_TRACK_VALUE_RE } from './originMath'

describe('isValidOriginTrackValue (transform-origin track keyframe values)', () => {
  it('accepts single-component values (CSS applies them to both axes)', () => {
    expect(isValidOriginTrackValue('50%')).toBe(true)
    expect(isValidOriginTrackValue('0px')).toBe(true)
    expect(isValidOriginTrackValue('-12.5em')).toBe(true)
  })

  it('accepts two-component values', () => {
    expect(isValidOriginTrackValue('25% 80%')).toBe(true)
    expect(isValidOriginTrackValue('10px 20px')).toBe(true)
    expect(isValidOriginTrackValue('-5% 110vh')).toBe(true)
  })

  it('accepts surrounding whitespace (trimmed)', () => {
    expect(isValidOriginTrackValue('  25% 80%  ')).toBe(true)
  })

  it('rejects keywords, bare numbers, angles, and z-components', () => {
    expect(isValidOriginTrackValue('center')).toBe(false)
    expect(isValidOriginTrackValue('left top')).toBe(false)
    expect(isValidOriginTrackValue('50')).toBe(false)
    expect(isValidOriginTrackValue('45deg')).toBe(false)
    // z-axis is out of scope for v1 (plan open Q3)
    expect(isValidOriginTrackValue('25% 80% 10px')).toBe(false)
    expect(isValidOriginTrackValue('')).toBe(false)
  })

  it('regex anchors prevent partial matches', () => {
    expect(ORIGIN_TRACK_VALUE_RE.test('25% garbage')).toBe(false)
  })
})
