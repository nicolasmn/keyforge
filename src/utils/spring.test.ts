import { describe, it, expect } from 'vitest'
import { generateSpringLinear, perceptualToConfig, settleTime, SPRING_PRESETS } from './spring'

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
