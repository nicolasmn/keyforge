import { describe, it, expect } from 'vitest'
import { degFromPoint, wrapDeg } from './dialGeometry'

describe('wrapDeg', () => {
  it('leaves in-range values alone', () => {
    expect(wrapDeg(0)).toBe(0)
    expect(wrapDeg(359)).toBe(359)
    expect(wrapDeg(90)).toBe(90)
  })

  it('wraps 360 and multiples back to [0, 360)', () => {
    expect(wrapDeg(360)).toBe(0)
    expect(wrapDeg(720)).toBe(0)
    expect(wrapDeg(375)).toBe(15)
  })

  it('wraps negatives into [0, 360)', () => {
    expect(wrapDeg(-1)).toBe(359)
    expect(wrapDeg(-90)).toBe(270)
    expect(wrapDeg(-360)).toBe(0)
  })
})

describe('degFromPoint', () => {
  // 0° = up (N), clockwise positive: E=90, S=180, W=270.
  it.each([
    ['north', 0, -10],
    ['east', 10, 0],
    ['south', 0, 10],
    ['west', -10, 0],
  ])('cardinal %s maps to the correct angle', (_dir, dx, dy) => {
    const expected = { north: 0, east: 90, south: 180, west: 270 }[_dir as 'north']
    expect(degFromPoint(0, 0, dx, dy)).toBe(expected)
  })

  it.each([
    ['NE', 10, -10, 45],
    ['SE', 10, 10, 135],
    ['SW', -10, 10, 225],
    ['NW', -10, -10, 315], // wraps across the 359↔0 boundary
  ])('diagonal %s maps to %i degrees', (_dir, dx, dy, expected) => {
    expect(degFromPoint(0, 0, dx, dy)).toBe(expected)
  })

  it('is independent of where the center sits in the viewport', () => {
    expect(degFromPoint(100.5, 50.25, 100.5, 40.25)).toBe(0)
    expect(degFromPoint(100.5, 50.25, 110.5, 50.25)).toBe(90)
  })

  it('degenerate center point returns wrapped fallback, never NaN', () => {
    expect(degFromPoint(5, 5, 5, 5)).toBe(0)
    expect(degFromPoint(5, 5, 5, 5, 217)).toBe(217)
    expect(degFromPoint(5, 5, 5, 5, 380)).toBe(20) // fallback wraps too
    expect(Number.isNaN(degFromPoint(9, 9, 9, 9, 42))).toBe(false)
  })
})
