import { describe, it, expect } from 'vitest'
import {
  sampleEasing,
  sampleEasingPoints,
  easingYExtent,
  paddedExtent,
  curveToPathD,
  formatBezier,
  resolveBuiltin,
  builtinNameFor,
} from './easingCurve'
import { BUILTIN_PRESETS, parseCubicBezier, evalCubicBezier } from './easing-presets'
import { perceptualToConfig, generateSpringLinear, settleTime, sampleSpring } from './spring'

describe('sampleEasing parity', () => {
  it('matches evalCubicBezier for every builtin cubic-bezier preset', () => {
    for (const p of BUILTIN_PRESETS) {
      const parsed = parseCubicBezier(p.value)
      if (!parsed) continue
      for (const t of [0, 0.05, 0.24, 0.5, 0.57, 0.75, 1]) {
        expect(sampleEasing(p.value, t), `${p.name} @${t}`).toBeCloseTo(
          evalCubicBezier(t, parsed),
          10,
        )
      }
    }
  })

  it('resolves named keywords through BUILTIN_PRESETS (not just literals)', () => {
    // 'ease-in-out' the KEYWORD is not a cubic-bezier literal; it must still
    // resolve to its preset curve.
    const named = sampleEasing('ease-in-out', 0.5)
    const literal = sampleEasing(BUILTIN_PRESETS[4].value, 0.5)
    expect(named).not.toBeNull()
    expect(named).toBeCloseTo(literal!, 10)
    expect(sampleEasing('ease', 0.25)).toBeCloseTo(evalCubicBezier(0.25, [0.25, 0.1, 0.25, 1]), 10)
  })

  it('treats the linear keyword as identity', () => {
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      expect(sampleEasing('linear', t)).toBeCloseTo(t, 12)
    }
  })

  it('returns null for unknown/unsupported values (thumbnail falls back to a line)', () => {
    expect(sampleEasing('steps(4)', 0.5)).toBeNull()
    expect(sampleEasing('banana', 0.5)).toBeNull()
    expect(sampleEasing('', 0.5)).toBeNull()
    expect(sampleEasing('linear(', 0.5)).toBeNull()
  })
})

describe('linear() stop sampling', () => {
  it('matches the spring physics that generated the stops', () => {
    const cfg = perceptualToConfig({ visualDurationMs: 450, bounce: 0.22 })
    const str = generateSpringLinear(cfg)
    const total = Math.min(settleTime(cfg) * 1.05, 10)
    for (const t of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      // Stops carry 4dp positions — allow rounding slop beyond that.
      expect(sampleEasing(str, t), `spring @${t}`).toBeCloseTo(sampleSpring(cfg, t * total), 3)
    }
  })

  it('interpolates piecewise-linear between explicit stops', () => {
    const v = 'linear(0, 1 50%, 0)'
    expect(sampleEasing(v, 0.25)).toBeCloseTo(0.5, 10)
    expect(sampleEasing(v, 0.5)).toBeCloseTo(1, 10)
    expect(sampleEasing(v, 0.75)).toBeCloseTo(0.5, 10)
  })

  it('normalizes legacy strings whose last stop does not reach 100%', () => {
    const pts = sampleEasingPoints('linear(0, 1 40%)')
    expect(pts).not.toBeNull()
    expect(pts![pts!.length - 1].v).toBeCloseTo(1, 10)
    expect(pts![pts!.length - 1].t).toBeCloseTo(1, 10)
  })
})

describe('overshoot correctness (#84 constraint: never silently clamped)', () => {
  it('anticipate dips to ≈−0.12 around ~24% progress', () => {
    const pts = sampleEasingPoints('anticipate')!
    const min = Math.min(...pts.map((p) => p.v))
    const atMin = pts.reduce((a, b) => (b.v < a.v ? b : a))
    expect(min).toBeLessThanOrEqual(-0.09)
    expect(min).toBeGreaterThanOrEqual(-0.16)
    expect(atMin.t).toBeGreaterThan(0.12)
    expect(atMin.t).toBeLessThan(0.36)
  })

  it('overshoot peaks at ≈+1.10 around ~57% progress', () => {
    const pts = sampleEasingPoints('overshoot')!
    const max = Math.max(...pts.map((p) => p.v))
    const atMax = pts.reduce((a, b) => (b.v > a.v ? b : a))
    expect(max).toBeGreaterThanOrEqual(1.06)
    expect(max).toBeLessThanOrEqual(1.14)
    expect(atMax.t).toBeGreaterThan(0.42)
    expect(atMax.t).toBeLessThan(0.72)
  })

  it('settle peaks gently at ≈+1.04 around ~53% progress', () => {
    const pts = sampleEasingPoints('settle')!
    const max = Math.max(...pts.map((p) => p.v))
    const atMax = pts.reduce((a, b) => (b.v > a.v ? b : a))
    expect(max).toBeGreaterThanOrEqual(1.01)
    expect(max).toBeLessThanOrEqual(1.08)
    expect(atMax.t).toBeGreaterThan(0.38)
    expect(atMax.t).toBeLessThan(0.68)
  })
})

describe('easingYExtent / paddedExtent', () => {
  it('keeps identity framing for in-range curves', () => {
    const pts = sampleEasingPoints('ease-in-out')!
    expect(easingYExtent(pts)).toEqual({ lo: 0, hi: 1 })
  })

  it('expands for overshoot curves and always contains their extremes', () => {
    for (const name of ['anticipate', 'overshoot', 'settle']) {
      const pts = sampleEasingPoints(name)!
      const { lo, hi } = easingYExtent(pts)
      for (const p of pts) {
        expect(p.v).toBeGreaterThanOrEqual(lo - 1e-9)
        expect(p.v).toBeLessThanOrEqual(hi + 1e-9)
      }
      expect(lo).toBeLessThan(0)
      expect(hi).toBeGreaterThan(1)
    }
  })

  it('paddedExtent mirrors bezierYScale semantics (identity inside [0,1])', () => {
    expect(paddedExtent(0, 1)).toEqual({ lo: 0, hi: 1 })
    expect(paddedExtent(0.2, 0.8)).toEqual({ lo: 0, hi: 1 })
    const e = paddedExtent(0, 1.1)
    expect(e.hi).toBeGreaterThan(1.1)
    expect(e.lo).toBeLessThan(0)
  })
})

describe('curveToPathD / formatBezier', () => {
  it('draws an identity curve corner-to-corner in a known box', () => {
    const d = curveToPathD(
      [
        { t: 0, v: 0 },
        { t: 1, v: 1 },
      ],
      30,
      18,
      2,
    )
    expect(d).toBe('M2 16 L28 2')
  })

  it('keeps x monotonically increasing and y inverted (up = larger value)', () => {
    const pts = sampleEasingPoints('ease-out')!
    const d = curveToPathD(pts, 30, 18, 2)
    const coords = [...d.matchAll(/([ML])([\d.]+) ([\d.]+)/g)].map((m) => ({
      x: parseFloat(m[2]),
      y: parseFloat(m[3]),
    }))
    for (let i = 1; i < coords.length; i++) {
      expect(coords[i].x).toBeGreaterThanOrEqual(coords[i - 1].x)
    }
    // ease-out rises fast → first point below center, last point at top.
    expect(coords[coords.length - 1].y).toBeLessThan(coords[0].y)
  })

  it('formatBezier round-trips through parseCubicBezier', () => {
    const h: [number, number, number, number] = [0.34, 1.56, 0.64, 1]
    const s = formatBezier(h)
    expect(parseCubicBezier(s)).toEqual(h)
    expect(formatBezier([0.12345, -0.5, 1, 1])).toBe('cubic-bezier(0.123, -0.5, 1, 1)')
  })
})

describe('builtin lookups', () => {
  it('resolveBuiltin matches by name and by exact value', () => {
    expect(resolveBuiltin('ease-out')).toBe(BUILTIN_PRESETS[3].value)
    expect(resolveBuiltin(BUILTIN_PRESETS[3].value)).toBe(BUILTIN_PRESETS[3].value)
    expect(resolveBuiltin('nope')).toBeNull()
  })

  it('builtinNameFor resolves display names both ways', () => {
    expect(builtinNameFor('ease-out')).toBe('ease-out')
    expect(builtinNameFor(BUILTIN_PRESETS[14].value)).toBe('anticipate')
    expect(builtinNameFor('cubic-bezier(9, 9, 9, 9)')).toBeNull()
  })

  it('sampleEasingPoints includes real stop vertices for kinked linear() values', () => {
    const pts = sampleEasingPoints('linear(0, 1 50%)')!
    expect(pts.some((p) => Math.abs(p.t - 0.5) < 1e-9)).toBe(true)
  })
})
