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

  // UNIFIED LADDER (owner spec): default = whole-number steps,
  // Alt = ÷10 fine, Shift = ×10 coarse. Alt beats Shift when both held.
  it('default drags quantize to whole-number steps', () => {
    // px sensitivity 3 → 30px = exactly +10 units
    expect(scrubbedValue(st('px', 100), 30, {})).toBe(110)
    // sub-step movement stays put until half a step is crossed
    expect(scrubbedValue(st('px', 100), 1, {})).toBe(100)
  })

  // deg sensitivity = 2 px/unit → 50px = raw +25.
  it('shift makes the drag coarser (×10 steps)', () => {
    // raw +25: base step 1 → 25; ×10 step → round(2.5)=3 tens → 30
    expect(scrubbedValue(st('deg', 0), 50, {})).toBe(25)
    expect(scrubbedValue(st('deg', 0), 50, { shift: true })).toBe(30)
  })

  // deg: 5px = raw +2.5. Base step 1 → round(2.5)=3; Alt step 0.1 → 2.5 exact.
  it('alt makes the drag finer (÷10 steps)', () => {
    expect(scrubbedValue(st('deg', 0), 5, {})).toBe(3)
    expect(scrubbedValue(st('deg', 0), 5, { alt: true })).toBeCloseTo(2.5, 3)
  })

  it('alt beats shift when both held (fine wins)', () => {
    expect(scrubbedValue(st('px', 100), 30, { alt: true, shift: true })).toBeCloseTo(
      scrubbedValue(st('px', 100), 30, { alt: true }),
      2,
    )
  })

  it('fractional-scale properties keep a 0.05 base step', () => {
    // opacity: 150px per 1.0 → 15px = +0.1 in 0.05 quanta
    expect(
      scrubbedValue({ startX: 0, startValue: 0.5, unit: '', property: 'opacity' }, 15, {}),
    ).toBeCloseTo(0.6, 3)
  })

  it('off-grid start values never jump on grab (delta-relative snapping)', () => {
    expect(scrubbedValue(st('px', 100.37), 1, {})).toBe(100.37)
  })

  it('bare numbers move slowly (opacity-scale sensitivity)', () => {
    // 150px per 1.0 keeps bare numbers gentle; quantization applies.
    // 30px ≈ raw +0.2 → rounds below half a step → stays at start.
    expect(scrubbedValue(st('', 0.5), 30, {})).toBe(0.5)
    // 90px ≈ raw +0.6 → crosses one full unit.
    expect(scrubbedValue(st('', 0.5), 90, {})).toBe(1.5)
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
