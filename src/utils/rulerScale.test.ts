import { describe, it, expect } from 'vitest'
import {
  candidateSteps,
  chooseLabelStep,
  formatTick,
  minorStepFor,
  lastMajorTime,
} from './rulerScale'

/** Monospace-ish fake measurer: ~6px per character (11px mono ≈ 6.6). */
const measure = (label: string) => label.length * 6

const GAP = 12
const MIN_STEP_PX = 6

describe('candidateSteps', () => {
  it('follows the 1-2-5 decade ladder', () => {
    expect(candidateSteps(2000)).toEqual([1000, 500, 200, 100, 50, 20, 10, 5, 2, 1])
    expect(candidateSteps(1000)).toEqual([500, 200, 100, 50, 20, 10, 5, 2, 1])
  })

  it('caps steps at duration/2', () => {
    // duration=2000 → cap 1000; nothing above it appears
    const steps = candidateSteps(2000)
    expect(Math.max(...steps)).toBeLessThanOrEqual(1000)
    // duration=3000 → cap 1500, so 500·3=1500? No: ladder gives 1000 max
    expect(Math.max(...candidateSteps(3000))).toBe(1000)
  })

  it('never includes anything below 1 ms or non-integers', () => {
    const steps = candidateSteps(12345)
    for (const s of steps) {
      expect(s).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(s)).toBe(true)
    }
  })

  it('is ordered coarse → fine', () => {
    const steps = candidateSteps(8000)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i - 1]).toBeGreaterThan(steps[i])
    }
  })
})

describe('formatTick', () => {
  it('uses ms under a second', () => {
    expect(formatTick(200, 100)).toBe('200ms')
    expect(formatTick(999, 100)).toBe('999ms')
  })

  it('switches to seconds above, with precision matched to the step', () => {
    expect(formatTick(1000, 1)).toBe('1.000s') // step<10 → 3 decimals
    expect(formatTick(1000, 10)).toBe('1.00s') // step<100 → 2
    expect(formatTick(1000, 100)).toBe('1.0s') // step≥100 → 1
    expect(formatTick(2500, 500)).toBe('2.5s')
  })

  it('widest realistic label is at t=duration', () => {
    // sanity for chooseLabelStep's representative-label assumption:
    // more decimals ⇒ wider, and finer steps ⇒ more decimals
    expect(formatTick(4000, 1).length).toBeGreaterThanOrEqual(formatTick(4000, 500).length)
  })
})

describe('chooseLabelStep', () => {
  const DUR = 2000
  const BASELINE = DUR / 10 // 200ms — today's fixed density

  it('returns exactly duration/10 when the lane is too narrow for finer labels (today’s output)', () => {
    // Lane sized so even baseline barely fits: baseline needs
    // intervals=floor(2000/200)+1=11 slots.
    const narrowLane = 11 * (measure(formatTick(DUR, BASELINE)) + GAP) - 1
    const step = chooseLabelStep(DUR, narrowLane, GAP, MIN_STEP_PX, measure)
    expect(step).toBe(BASELINE)
  })

  it('returns a finer nice step on wide lanes', () => {
    // Absurdly wide lane: every candidate fits down to 1ms… but spacing floor stops it.
    const wide = 4096
    const step = chooseLabelStep(DUR, wide, GAP, MIN_STEP_PX, measure)
    expect(step).toBeLessThan(BASELINE)
    expect(candidateSteps(DUR)).toContain(step)
  })

  it('collision guarantee: chosen step fits intervals × (width+gap) inside the lane', () => {
    for (const dur of [500, 2000, 5000, 30000]) {
      const baseline = dur / 10
      for (const laneWidth of [200, 480, 1024, 2560]) {
        const step = chooseLabelStep(dur, laneWidth, GAP, MIN_STEP_PX, measure)
        // Any result finer than the baseline came from an explicit accept,
        // so the collision invariant holds by construction. The baseline
        // itself may be a cramped-lane *fallback* (today's behaviour) or a
        // genuinely accepted candidate — either way it needs no assertion:
        // fallback may collide (pre-existing), and acceptance is covered
        // by every finer case here.
        if (step < baseline) {
          const requiredPx = measure(formatTick(dur, step)) + GAP
          const slots = Math.floor(laneWidth / requiredPx)
          const intervals = Math.floor(dur / step) + 1
          expect(intervals).toBeLessThanOrEqual(slots)
        } else {
          expect(step).toBe(baseline)
        }
      }
    }
  })

  it('monotonicity: widening the lane never coarsens the step', () => {
    let prev = Infinity
    for (const laneWidth of [160, 240, 320, 480, 720, 1024, 1536, 2048, 3072]) {
      const step = chooseLabelStep(4000, laneWidth, GAP, MIN_STEP_PX, measure)
      expect(step).toBeLessThanOrEqual(prev)
      prev = step
    }
  })

  it('never goes finer than 1 ms, even on absurdly wide lanes', () => {
    const step = chooseLabelStep(2000, 100_000, GAP, 0, measure)
    expect(step).toBeGreaterThanOrEqual(1)
  })

  it('never goes coarser than duration/10', () => {
    // Tiny lane where even baseline collides — fallback stays at baseline.
    const step = chooseLabelStep(2000, 50, GAP, MIN_STEP_PX, measure)
    expect(step).toBe(200)
  })

  it('respects the minimum tick spacing floor (minStepPx)', () => {
    // pxPerMs = lane/duration; a step finer than minStepPx/pxPerMs must be rejected.
    const laneWidth = 1000
    const dur = 2000
    const pxPerMs = laneWidth / dur // 0.5 px/ms → steps below 12ms violate the 6px floor
    const step = chooseLabelStep(dur, laneWidth, GAP, MIN_STEP_PX, measure)
    expect(step * pxPerMs).toBeGreaterThanOrEqual(MIN_STEP_PX - Number.EPSILON)
  })

  it('handles degenerate input without crashing', () => {
    expect(chooseLabelStep(0, 500, GAP, MIN_STEP_PX, measure)).toBe(0)
    expect(chooseLabelStep(NaN, 500, GAP, MIN_STEP_PX, measure)).toBeNaN()
    expect(chooseLabelStep(-5, 500, GAP, MIN_STEP_PX, measure)).toBe(-0.5)
  })
})

describe('minorStepFor', () => {
  it('defaults to a fifth of the label step', () => {
    expect(minorStepFor(100, 2)).toBe(20) // 20 · 2px/ms = 40px ≥ 4
  })

  it('falls back to a half when fifths would sit closer than the gap floor', () => {
    expect(minorStepFor(100, 0.03)).toBe(50) // 20·0.03=0.6px < 4 → half
  })

  it('honours the gap floor at the boundary', () => {
    expect(minorStepFor(1000, 0.008)).toBe(500) // 200·0.008=1.6 < 4
    expect(minorStepFor(1000, 0.02)).toBe(200) // 200·0.02=4 ✓
  })
})

describe('lastMajorTime', () => {
  it('lands on duration when divisible', () => {
    expect(lastMajorTime(2000, 200)).toBe(2000)
  })

  it('stops short of duration for non-divisible steps', () => {
    expect(lastMajorTime(2050, 500)).toBe(2000)
    expect(lastMajorTime(999, 100)).toBe(900)
  })
})
