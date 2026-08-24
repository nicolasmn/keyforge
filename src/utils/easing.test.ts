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

  it('round-trips out-of-range Y control points losslessly', () => {
    const values = [
      'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      'cubic-bezier(0.6,-0.28,0.735,0.045)', // negatives, no spaces
      'cubic-bezier(0.34, 1.56, 0.64, 1)',
      'cubic-bezier(0.1, -1, 0.9, 2)',
    ]
    for (const v of values) {
      const once = parseCubicBezier(v)
      expect(once, v).not.toBeNull()
      // Re-format the parsed numbers the way EasingEditor.applyHandles does
      // and parse again — must be identical.
      const formatted = `cubic-bezier(${once!.map((n) => +n.toFixed(3)).join(', ')})`
      expect(parseCubicBezier(formatted), formatted).toEqual(once)
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

  it('passes through both endpoints for every preset, overshoot included', () => {
    // Y(1) = ay+by+cy = 1 identically (endpoint P3 = (1,1)), so the old
    // "only when y2 === 1" caveat was unnecessary — assert it outright.
    for (const p of BUILTIN_PRESETS) {
      const bez = parseCubicBezier(p.value)
      if (!bez) continue
      expect(evalCubicBezier(0, bez), `${p.name} @0`).toBeCloseTo(0, 6)
      expect(evalCubicBezier(1, bez), `${p.name} @1`).toBeCloseTo(1, 6)
    }
  })

  it('overshoot presets actually leave [0,1] mid-curve', () => {
    const byName = Object.fromEntries(BUILTIN_PRESETS.map((p) => [p.name, p.value]))
    const anticipate = parseCubicBezier(byName['anticipate'])!
    const overshoot = parseCubicBezier(byName['overshoot'])!
    const settle = parseCubicBezier(byName['settle'])!

    let minAnticipate = Infinity
    let maxOvershoot = -Infinity
    let maxSettle = -Infinity
    for (let i = 0; i <= 400; i++) {
      const t = i / 400
      minAnticipate = Math.min(minAnticipate, evalCubicBezier(t, anticipate))
      maxOvershoot = Math.max(maxOvershoot, evalCubicBezier(t, overshoot))
      maxSettle = Math.max(maxSettle, evalCubicBezier(t, settle))
    }
    // Anticipation: dips below the start value before arriving.
    expect(minAnticipate).toBeLessThan(-0.05)
    // Overshoot passes well beyond the target; settle only gently.
    expect(maxOvershoot).toBeGreaterThan(1.05)
    expect(maxSettle).toBeGreaterThan(1)
    expect(maxSettle).toBeLessThan(1.1)
  })

  it('matches a dense bisection reference on extreme overshoot curves', () => {
    // Reference: solve x(s)=t by pure bisection (80 iterations), sample Y.
    function referenceY(t: number, c: [number, number, number, number]): number {
      const [x1, y1, x2, y2] = c
      const cx = 3 * x1
      const bx = 3 * (x2 - x1) - cx
      const ax = 1 - cx - bx
      const cy = 3 * y1
      const by = 3 * (y2 - y1) - cy
      const ay = 1 - cy - by
      const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s
      const sampleY = (s: number) => ((ay * s + by) * s + cy) * s
      let lo = 0
      let hi = 1
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2
        if (sampleX(mid) < t) lo = mid
        else hi = mid
      }
      return sampleY((lo + hi) / 2)
    }

    const extreme: [number, number, number, number][] = [
      [0.68, -0.55, 0.265, 1.55], // ease-in-out-back: both directions
      [0.01, -1, 0.99, 2], // deliberately violent handles
      [0.68, -0.55, 0.265, 1], // anticipate
      [0.34, 1.56, 0.64, 1], // overshoot
    ]
    for (const c of extreme) {
      for (let i = 1; i < 100; i++) {
        const t = i / 100
        expect(evalCubicBezier(t, c)).toBeCloseTo(referenceY(t, c), 5)
      }
    }
  })
})

describe('overshoot presets (plan §3.4)', () => {
  const byName = new Map(BUILTIN_PRESETS.map((p) => [p.name, p.value]))

  it('adds the anticipate / overshoot / settle presets', () => {
    for (const name of ['anticipate', 'overshoot', 'settle']) {
      const v = byName.get(name)
      expect(v, name).toBeDefined()
      expect(parseCubicBezier(v!), name).not.toBeNull()
    }
  })

  it('keeps X in [0,1] while Y leaves it — cubic-bezier spec requirement', () => {
    for (const p of BUILTIN_PRESETS) {
      const parsed = parseCubicBezier(p.value)
      if (!parsed) continue // 'linear' keyword preset
      const [x1, y1, x2, y2] = parsed
      expect(x1, `${p.name} x1`).toBeGreaterThanOrEqual(0)
      expect(x1, `${p.name} x1`).toBeLessThanOrEqual(1)
      expect(x2, `${p.name} x2`).toBeGreaterThanOrEqual(0)
      expect(x2, `${p.name} x2`).toBeLessThanOrEqual(1)
      if (['anticipate', 'overshoot', 'settle'].includes(p.name)) {
        // The whole point: at least one control-point Y outside the unit box.
        expect(y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1, `${p.name} y out of range`).toBe(true)
      }
    }
  })

  it('does not duplicate values already covered by other presets', () => {
    const seen = new Map<string, string>()
    for (const p of BUILTIN_PRESETS) {
      if (!p.value.startsWith('cubic-bezier')) continue
      // Normalize whitespace so 'a, b' and 'a,b' compare equal.
      const key = parseCubicBezier(p.value)!.join(',')
      expect(seen.has(key), `duplicate value between ${seen.get(key)} and ${p.name}`).toBe(false)
      seen.set(key, p.name)
    }
  })
})
