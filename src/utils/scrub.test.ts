import { describe, it, expect } from 'vitest'
import { scrubbedValue, sensitivityFor, clampToProperty } from './scrub'

const st = (unit = '', startValue = 0.5) => ({ startX: 0, startValue, unit })

describe('scrubbedValue', () => {
  it('increases with rightward drag for px', () => {
    expect(scrubbedValue(st('px', 100), 30, {})).toBe(110)
  })

  it('decreases with leftward drag', () => {
    expect(scrubbedValue(st('px', 100), -30, {})).toBe(90)
  })

  it('shift makes the drag finer (÷10 effect)', () => {
    const plain = scrubbedValue(st('px', 100), 30, {})
    const fine = scrubbedValue(st('px', 100), 30, { shift: true })
    expect(fine).toBeCloseTo(100 + (plain - 100) / 10, 2)
  })

  it('alt makes the drag coarser (×10 effect)', () => {
    const plain = scrubbedValue(st('px', 100), 30, {})
    const coarse = scrubbedValue(st('px', 100), 30, { alt: true })
    expect(coarse).toBeCloseTo(100 + (plain - 100) * 10, 1)
  })

  it('bare numbers move slowly (opacity-scale sensitivity)', () => {
    // 150px per 1.0 → 30px ≈ 0.2
    expect(scrubbedValue(st('', 0.5), 30, {})).toBeCloseTo(0.7, 3)
  })
})

describe('sensitivityFor', () => {
  it('has a fallback for unknown units', () => {
    expect(sensitivityFor('frobnicate')).toBeGreaterThan(0)
  })
})

describe('clampToProperty', () => {
  it('clamps opacity to [0,1]', () => {
    expect(clampToProperty('opacity', 1.4)).toBe(1)
    expect(clampToProperty('opacity', -0.2)).toBe(0)
    expect(clampToProperty('opacity', 0.5)).toBe(0.5)
  })

  it('clamps width/height at zero', () => {
    expect(clampToProperty('width', -50)).toBe(0)
  })

  it('leaves unknown properties alone', () => {
    expect(clampToProperty(undefined, -5)).toBe(-5)
  })
})
