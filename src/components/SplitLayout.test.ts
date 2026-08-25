import { describe, expect, it } from 'vitest'
import { clampPanelPixels } from '@/components/SplitLayout'

describe('clampPanelPixels', () => {
  const min = [160, 300, 220]
  const max = [320, Infinity, 400]

  it('clamps each panel into its own [min, max] window', () => {
    // Desired: inspector way over its 400 cap, sidebar under its 160 floor.
    const out = clampPanelPixels([100, 500, 497], min, max, 1000)
    expect(out[0]).toBeGreaterThanOrEqual(160)
    expect(out[0]).toBeLessThanOrEqual(320)
    expect(out[2]).toBeLessThanOrEqual(400)
  })

  it('returns panels summing to the available space', () => {
    const available = 1404 // e.g. 1920 viewport minus gutters
    const out = clampPanelPixels(
      [18, 56, 26].map((p) => (p / 100) * available),
      min,
      max,
      available,
    )
    const total = out.reduce((a, b) => a + b, 0)
    expect(Math.abs(total - available)).toBeLessThan(1)
  })

  it('absorbs surplus into panels with headroom (the audit F14 case)', () => {
    // At 1920px the default percentages give the inspector ~497px (>400 cap).
    // The overflow must go to the unbounded preview, not stay on the inspector.
    const available = 1908
    const desired = [343, 1068, 497]
    const out = clampPanelPixels(desired, min, max, available)
    expect(out[2]).toBeLessThanOrEqual(400)
    expect(out[1]).toBeGreaterThan(desired[1]) // preview absorbs the surplus
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(available, 0)
  })

  it('deficit shrinks flexible panels proportionally', () => {
    const available = 800
    const out = clampPanelPixels([300, 400, 350], min, max, available)
    const total = out.reduce((a, b) => a + b, 0)
    expect(Math.abs(total - available)).toBeLessThan(1)
    expect(out.every((v, i) => v >= min[i])).toBe(true)
  })

  it('degenerate case (available < Σmin) returns all minimums', () => {
    const out = clampPanelPixels([500, 500, 500], min, max, 500)
    expect(out).toEqual([...min])
  })

  it('handles Infinity max without producing NaN', () => {
    const out = clampPanelPixels([200, NaN, 300], min, max, 1000)
    out.forEach((v) => expect(Number.isFinite(v)).toBe(true))
  })
})

describe('clampPanelPixels — 2-pane (Phase B: Preview | Inspector)', () => {
  const min = [300, 220]
  const max = [Infinity, 400]

  it('splits [68,32] proportions and honors both minimums', () => {
    const out = clampPanelPixels([680, 320], min, max, 1000)
    expect(out[0]).toBeGreaterThanOrEqual(min[0])
    expect(out[1]).toBeGreaterThanOrEqual(min[1])
    expect(out[1]).toBeLessThanOrEqual(max[1])
    expect(Math.abs(out.reduce((a, b) => a + b, 0) - 1000)).toBeLessThan(1)
  })

  it('narrow container shrinks both panels proportionally above minimums', () => {
    const out = clampPanelPixels([680, 320], min, max, 700)
    // Proportional shrink: 680/1000*700 ≈ 476, 320/1000*700 = 224.
    expect(out[0]).toBeGreaterThanOrEqual(min[0])
    expect(out[1]).toBeGreaterThanOrEqual(min[1])
    expect(out[1]).toBeLessThanOrEqual(max[1])
    expect(Math.abs(out.reduce((a, b) => a + b, 0) - 700)).toBeLessThan(1)
  })

  it('degenerate 2-pane case (available < Σmin) returns both minimums', () => {
    const out = clampPanelPixels([500, 400], min, max, 500)
    expect(out).toEqual([...min])
  })
})
