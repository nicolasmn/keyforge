import { describe, it, expect } from 'vitest'
import { snapTime, SNAP_VALUES } from './snap'
import type { SnapIncrement } from './snap'

describe('snapTime — off', () => {
  it("'off' returns the input unchanged", () => {
    expect(snapTime(1234, 'off')).toBe(1234)
  })

  it("'off' passes fractional input through untouched", () => {
    expect(snapTime(123.456, 'off')).toBe(123.456)
  })

  it("'off' does not clamp out-of-range input (call sites clamp via xToTime)", () => {
    expect(snapTime(9999, 'off', 2000)).toBe(9999)
    expect(snapTime(-50, 'off', 2000)).toBe(-50)
  })
})

describe('snapTime — rounding', () => {
  it('rounds to the nearest increment (down)', () => {
    expect(snapTime(1234, 100)).toBe(1200)
  })

  it('rounds to the nearest increment (up)', () => {
    expect(snapTime(1260, 100)).toBe(1300)
  })

  it('midpoints round half-up: 1250 @ inc=500 → 1500 (documented)', () => {
    expect(snapTime(1250, 500)).toBe(1500)
    expect(snapTime(250, 500)).toBe(500)
    expect(snapTime(249.9, 500)).toBe(0)
  })

  it('inc=1 always returns an integer', () => {
    for (const t of [0, 0.4, 12.7, 99.5, 1234.5678]) {
      expect(Number.isInteger(snapTime(t, 1))).toBe(true)
    }
    expect(snapTime(1234.5678, 1)).toBe(1235)
  })

  it('already-on-grid values pass through exactly', () => {
    expect(snapTime(1500, 500)).toBe(1500)
    expect(snapTime(0, 100)).toBe(0)
  })
})

describe('snapTime — clamping', () => {
  it('negative input clamps to 0', () => {
    expect(snapTime(-75, 100)).toBe(0)
  })

  it('input above max clamps to max', () => {
    expect(snapTime(9999, 100, 2000)).toBe(2000)
  })

  it('exactly-max input passes through', () => {
    expect(snapTime(2000, 100, 2000)).toBe(2000)
  })

  it('no max argument ⇒ no upper clamp', () => {
    expect(snapTime(98_765, 100)).toBe(98_800)
  })

  it("clamped-to-max result is exact even when duration isn't on-grid", () => {
    // e.g. duration=2050 with inc=100: snapped 2100 → clamps to 2050 exactly
    expect(snapTime(2080, 100, 2050)).toBe(2050)
  })
})

describe('snapTime — robustness', () => {
  it('floating-point noise near a grid point normalizes cleanly', () => {
    expect(snapTime(999.9999999, 500)).toBe(1000)
    expect(snapTime(299.9999999, 100)).toBe(300)
  })

  it('non-finite input passes through unchanged', () => {
    expect(snapTime(NaN, 100)).toBeNaN()
    expect(snapTime(Infinity, 100)).toBe(Infinity)
    expect(snapTime(-Infinity, 100)).toBe(-Infinity)
  })

  it('every increment divides evenly into itself', () => {
    for (const v of SNAP_VALUES) {
      expect(snapTime(v, v as SnapIncrement)).toBe(v)
    }
  })

  it('SNAP_VALUES matches the documented ladder', () => {
    expect(SNAP_VALUES).toEqual([1, 10, 100, 500, 1000])
  })
})
