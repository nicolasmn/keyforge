import { describe, it, expect } from 'vitest'
import { formatAngle, snapToMultiple, toDeg, ANGLE_UNIT_PRECISION } from './cssCompletions'

const UNITS = ['deg', 'rad', 'turn', 'grad'] as const

// Emitted decimals are capped at rad's 4dp baseline: deg/grad are integers,
// turn needs at most one extra decimal over its 2dp base to round-trip, and
// rad's 4dp quantum (~0.006°) never needs widening either.
const MAX_EXPECTED_DECIMALS = 4

describe('formatAngle — DevTools per-unit precision table', () => {
  it('formats deg/grad as integers', () => {
    expect(formatAngle(90, 'deg')).toBe('90')
    expect(formatAngle(0, 'deg')).toBe('0')
    expect(formatAngle(100, 'grad')).toBe('111') // 100/0.9 = 111.11…
    expect(formatAngle(90, 'grad')).toBe('100')
  })

  it('formats turn with ≤2 decimals where that round-trips (DevTools baseline)', () => {
    expect(formatAngle(90, 'turn')).toBe('0.25')
    expect(formatAngle(180, 'turn')).toBe('0.5')
    expect(formatAngle(270, 'turn')).toBe('0.75')
  })

  it('formats rad with ≤4 decimals', () => {
    expect(formatAngle(45, 'rad')).toBe('0.7854')
    expect(formatAngle(180, 'rad')).toBe('3.1416')
  })

  it('trims trailing zeros', () => {
    expect(formatAngle(180, 'deg')).toBe('180')
    expect(formatAngle(180, 'turn')).toBe('0.5')
    expect(formatAngle(0, 'rad')).toBe('0')
    expect(formatAngle(360, 'grad')).toBe('0')
  })

  it('widens precision only when the DevTools baseline would not round-trip', () => {
    // 45° = exactly 0.125 turn; 2dp "0.13" reads back as 46.8° → must be 0.125.
    expect(formatAngle(45, 'turn')).toBe('0.125')
    // Common angles keep the short forms.
    expect(formatAngle(30, 'turn')).toBe('0.083') // 2dp "0.08" reads back 28.8°
    expect(formatAngle(60, 'turn')).toBe('0.167')
  })
})

describe('formatAngle — round-trip property (∀ d ∈ [0,359] × all units)', () => {
  for (const unit of UNITS) {
    it(`unit "${unit}" always reads back within 0.5° of the dialed value`, () => {
      for (let d = 0; d < 360; d++) {
        const out = formatAngle(d, unit)
        const back = toDeg(parseFloat(out), unit)
        expect(Math.abs(back - d)).toBeLessThanOrEqual(0.5)
      }
    })
  }

  it('never emits more decimals than the rad cap (4)', () => {
    for (const unit of UNITS) {
      for (let d = 0; d < 360; d += 7) {
        const decimals = formatAngle(d, unit).split('.')[1]?.length ?? 0
        expect(decimals).toBeLessThanOrEqual(MAX_EXPECTED_DECIMALS)
      }
    }
  })
})

describe('formatAngle — float-noise regressions', () => {
  it('never emits binary-float artifacts like 0.30000000000000004', () => {
    // 108/360 is 0.3 in decimal but a repeating value in binary FP.
    expect(formatAngle(108, 'turn')).toBe('0.3')
    // 81/360 = 0.225, which sits right on a rounding boundary in FP.
    expect(formatAngle(81, 'turn')).toBe('0.225')
    expect(formatAngle(27, 'rad')).toBe('0.4712')
  })

  it('output is always a plain decimal number — no scientific notation', () => {
    const plainNumber = /^[0-9]+(\.[0-9]+)?$/
    for (const unit of UNITS) {
      for (let d = 0; d < 360; d++) {
        expect(formatAngle(d, unit)).toMatch(plainNumber)
      }
    }
  })
})

describe('formatAngle — wrap policy', () => {
  it('wraps 360 ≡ 0 and multiples', () => {
    expect(formatAngle(360, 'deg')).toBe('0')
    expect(formatAngle(720, 'deg')).toBe('0')
    expect(formatAngle(360, 'turn')).toBe('0')
  })

  it('handles negative input by wrapping into [0, 360)', () => {
    expect(formatAngle(-90, 'deg')).toBe('270')
    expect(formatAngle(-1, 'deg')).toBe('359')
    expect(formatAngle(-90, 'turn')).toBe('0.75')
    expect(formatAngle(-90, 'grad')).toBe('300')
  })
})

describe('ANGLE_UNIT_PRECISION', () => {
  it('matches the DevTools roundAngleByUnit baselines', () => {
    expect(ANGLE_UNIT_PRECISION.deg).toBe(0)
    expect(ANGLE_UNIT_PRECISION.grad).toBe(0)
    expect(ANGLE_UNIT_PRECISION.turn).toBe(2)
    expect(ANGLE_UNIT_PRECISION.rad).toBe(4)
  })
})

describe('snapToMultiple (Shift+drag coarse snapping)', () => {
  it('snaps to nearest multiple of 15', () => {
    expect(snapToMultiple(82, 15)).toBe(75)
    expect(snapToMultiple(88, 15)).toBe(90)
    expect(snapToMultiple(90, 15)).toBe(90)
    expect(snapToMultiple(14, 15)).toBe(15) // 14 rounds up to 15 (nearest)
  })

  it('wraps across the 360→0 boundary', () => {
    expect(snapToMultiple(355, 15)).toBe(0) // snaps to 360 ≡ 0
    expect(snapToMultiple(-5, 15)).toBe(0) // snaps to -0 ≡ 0
    expect(snapToMultiple(350, 15)).toBe(345) // still nearer to 345 than 360
  })

  it('passes through unchanged when no step is given', () => {
    expect(snapToMultiple(82)).toBe(82)
    expect(snapToMultiple(82, undefined)).toBe(82)
    expect(snapToMultiple(123, 0)).toBe(123)
  })

  it('always returns values in [0, 360)', () => {
    for (let d = -720; d <= 720; d++) {
      const s = snapToMultiple(d, 15)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(360)
    }
  })
})
