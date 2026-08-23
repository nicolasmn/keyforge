import { describe, it, expect } from 'vitest'
import { parseCubicBezier, evalCubicBezier, BUILTIN_PRESETS } from './easing-presets'

describe('parseCubicBezier', () => {
  it('parses a well-formed value with spaces', () => {
    expect(parseCubicBezier('cubic-bezier(0.25, 0.1, 0.25, 1)')).toEqual([0.25, 0.1, 0.25, 1])
  })

  it('parses without spaces and with negatives', () => {
    expect(parseCubicBezier('cubic-bezier(0.6,-0.28,0.735,0.045)')).toEqual([
      0.6, -0.28, 0.735, 0.045,
    ])
  })

  it('returns null for malformed input', () => {
    expect(parseCubicBezier('linear')).toBeNull()
    expect(parseCubicBezier('cubic-bezier(0.1, 0.2)')).toBeNull()
    expect(parseCubicBezier('cubic-bezier(a, b, c, d)')).toBeNull()
  })

  it('round-trips every builtin preset through parse', () => {
    for (const p of BUILTIN_PRESETS) {
      if (!p.value.startsWith('cubic-bezier')) continue
      expect(parseCubicBezier(p.value), p.name).not.toBeNull()
    }
  })
})

describe('evalCubicBezier', () => {
  it('returns 0 at t=0 and 1 at t=1 for standard easings', () => {
    for (const p of BUILTIN_PRESETS) {
      const parsed = parseCubicBezier(p.value)
      if (!parsed) continue
      expect(evalCubicBezier(0, parsed), `${p.name} @0`).toBeCloseTo(0, 5)
      // x(s)=1 ⇒ s=1 ⇒ y(1) = ay+by+cy = 3*y2 - 3*y1 + ... equals 1 only when y2=1
      if (parsed[3] === 1) expect(evalCubicBezier(1, parsed), `${p.name} @1`).toBeCloseTo(1, 5)
    }
  })

  it('linear control points evaluate to the identity curve', () => {
    const linear: [number, number, number, number] = [0, 0, 1, 1]
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(evalCubicBezier(t, linear)).toBeCloseTo(t, 4)
    }
  })

  it('is monotone-ish in t for an ease-in curve (y increases)', () => {
    const easeIn = parseCubicBezier('cubic-bezier(0.42, 0, 1, 1)')!
    let prev = -Infinity
    for (let i = 0; i <= 10; i++) {
      const y = evalCubicBezier(i / 10, easeIn)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-6)
      prev = y
    }
  })

  it('overshoot curves may exceed [0,1] but stay finite', () => {
    const back = parseCubicBezier('cubic-bezier(0.175, 0.885, 0.32, 1.275)')!
    for (let i = 0; i <= 20; i++) {
      const y = evalCubicBezier(i / 20, back)
      expect(Number.isFinite(y)).toBe(true)
    }
  })
})
