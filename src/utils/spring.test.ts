import { describe, it, expect } from 'vitest'
import {
  generateSpringLinear,
  parseLinearEasing,
  perceptualToConfig,
  sampleSpring,
  settleTime,
  SPRING_PRESETS,
} from './spring'

describe('spring → linear() generator', () => {
  it('produces a linear() string with stops', () => {
    const out = generateSpringLinear({ stiffness: 170, damping: 26, mass: 1 })
    expect(out.startsWith('linear(')).toBe(true)
    expect(out).toContain('%')
    expect(out.split(',').length).toBeGreaterThanOrEqual(12)
  })

  it('starts at 0 and ends settled at 1', () => {
    const out = generateSpringLinear({ stiffness: 170, damping: 26, mass: 1 })
    const nums = out
      .slice('linear('.length, -1)
      .split(', ')
      .map((s) => Number.parseFloat(s))
    expect(nums[0]).toBeCloseTo(0, 2)
    expect(nums[nums.length - 1]).toBeCloseTo(1, 1)
  })

  it('bouncy config overshoots above 1', () => {
    const cfg = perceptualToConfig({ visualDurationMs: 600, bounce: 0.5 })
    const out = generateSpringLinear(cfg)
    const values = out
      .slice('linear('.length, -1)
      .split(', ')
      .map((s) => Number.parseFloat(s))
    expect(Math.max(...values)).toBeGreaterThan(1.02)
  })

  it('critically damped (bounce 0) never overshoots', () => {
    const cfg = perceptualToConfig({ visualDurationMs: 400, bounce: 0 })
    const out = generateSpringLinear(cfg)
    const values = out
      .slice('linear('.length, -1)
      .split(', ')
      .map((s) => Number.parseFloat(s))
    expect(Math.max(...values)).toBeLessThanOrEqual(1.001)
  })

  it('all presets produce valid output', () => {
    for (const [name, preset] of Object.entries(SPRING_PRESETS)) {
      const out = generateSpringLinear(perceptualToConfig(preset.perceptual))
      expect(out.startsWith('linear('), name).toBe(true)
      expect(out.length, name).toBeLessThan(2000)
    }
  })

  it('settleTime stays within bounds for extreme configs', () => {
    expect(settleTime({ stiffness: 500, damping: 4, mass: 1 })).toBeLessThan(10)
    // heavily overdamped + massive: slow crawl, capped at the max window
    expect(settleTime({ stiffness: 10, damping: 40, mass: 3 })).toBeLessThanOrEqual(10)
  })
})

describe('perceptualToConfig', () => {
  it('maps bounce 0 to critical damping', () => {
    const c = perceptualToConfig({ visualDurationMs: 500, bounce: 0 })
    const ratio = c.damping / (2 * Math.sqrt(c.stiffness * c.mass))
    expect(ratio).toBeCloseTo(1, 5)
  })

  it('longer visual duration lowers stiffness', () => {
    const fast = perceptualToConfig({ visualDurationMs: 250, bounce: 0.2 })
    const slow = perceptualToConfig({ visualDurationMs: 900, bounce: 0.2 })
    expect(fast.stiffness).toBeGreaterThan(slow.stiffness)
  })
})

describe('sampleSpring', () => {
  it('starts at 0 and settles at 1 for large t', () => {
    const cfg = { stiffness: 170, damping: 26, mass: 1 }
    expect(sampleSpring(cfg, 0)).toBeCloseTo(0, 6)
    expect(sampleSpring(cfg, 10)).toBeCloseTo(1, 5)
  })

  it('matches the stops embedded in generateSpringLinear output', () => {
    const cfg = perceptualToConfig({ visualDurationMs: 600, bounce: 0.45 })
    const out = generateSpringLinear(cfg)
    const body = out.slice('linear('.length, -1)
    const stops = body.split(', ').map((s) => s.split(/\s+/))
    const n = stops.length - 1
    expect(stops[n][1]).toBe('100%')
    const total = Math.min(settleTime(cfg) * 1.05, 10)
    // Spot-check a few samples against sampleSpring at the same instants.
    for (const i of [5, 17, 33, n]) {
      const tSec = (i / n) * total
      expect(Number.parseFloat(stops[i][0])).toBeCloseTo(sampleSpring(cfg, tSec), 3)
      expect(stops[i][1]).toBe(`${((i / n) * 100).toFixed(3).replace(/\.?0+$/, '') || '0'}%`)
    }
  })
})

describe('parseLinearEasing', () => {
  it('round-trips generateSpringLinear output', () => {
    const cfg = perceptualToConfig({ visualDurationMs: 450, bounce: 0.22 })
    const out = generateSpringLinear(cfg)
    const stops = parseLinearEasing(out.slice('linear('.length, -1))!
    expect(stops.length).toBeGreaterThanOrEqual(12)
    expect(stops[0].position).toBeCloseTo(0, 3)
    expect(stops[stops.length - 1].position).toBeCloseTo(1, 2)
    expect(stops[0].progress).toBe(0)
    expect(stops[stops.length - 1].progress).toBeCloseTo(1, 5)
  })

  it('fills in missing progresses evenly (CSS linear() shorthand)', () => {
    expect(parseLinearEasing('0, 1')).toEqual([
      { position: 0, progress: 0 },
      { position: 1, progress: 1 },
    ])
    const stops = parseLinearEasing('0 0%, 0.25, 0.75, 1')!
    expect(stops.map((s) => s.progress)).toEqual([0, 1 / 3, 2 / 3, 1])
  })

  it('returns null on garbage input', () => {
    expect(parseLinearEasing('')).toBe(null)
    expect(parseLinearEasing('abc def%')).toBe(null)
  })
})
