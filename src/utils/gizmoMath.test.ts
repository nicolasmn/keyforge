import { describe, it, expect } from 'vitest'
import {
  GIZMO_HIT_EPSILON_MS,
  clampScale,
  cursorForPart,
  formatRotateDeg,
  formatScaleNum,
  formatTranslate,
  gizmoWritePolicy,
  hitTestGizmo,
  inheritEasingForNewKeyframe,
  moveDelta,
  normalizeAngleRad,
  parseRotateDeg,
  parseScaleNum,
  parseTranslatePair,
  resolvePivot,
  rotateHandleCenter,
  rotationDelta,
  scaleFactor,
  snapRotationToStep,
  toLayoutPoint,
  type GizmoSpace,
} from './gizmoMath'

const RAD = Math.PI / 180

function makeSpace(scale: number, originLeft = 0, originTop = 0): GizmoSpace {
  return {
    rect: {
      left: originLeft * scale,
      top: originTop * scale,
      width: 600 * scale,
      height: 400 * scale,
    },
    layoutWidth: 600,
    layoutHeight: 400,
  }
}

describe('moveDelta', () => {
  it('returns plain layout-px offsets at scale 1', () => {
    const d = moveDelta({ space: makeSpace(1), x: 100, y: 100 }, 160, 130)
    expect(d).toEqual({ dx: 60, dy: 30 })
  })

  it('is scale-invariant: the same physical drag yields identical layout deltas at any --preview-scale', () => {
    // Same on-stage gesture measured through surfaces scaled 0.25…2. The
    // surface box AND the client-space pointer positions shrink together
    // (that is what --preview-scale does), so ratios cancel.
    const base = { startX: 200, startY: 150, curX: 320, curY: 270 }
    const expected = moveDelta(
      { space: makeSpace(1), x: base.startX, y: base.startY },
      base.curX,
      base.curY,
    )
    expect(expected).toEqual({ dx: 120, dy: 120 })
    for (const s of [0.25, 0.4, 0.5, 0.75, 1, 1.5, 2]) {
      const d = moveDelta(
        { space: makeSpace(s), x: base.startX * s, y: base.startY * s },
        base.curX * s,
        base.curY * s,
      )
      expect(d.dx).toBeCloseTo(expected.dx, 6)
      expect(d.dy).toBeCloseTo(expected.dy, 6)
    }
  })

  it('scales proportionally when the whole canvas grows (layout dims ×k)', () => {
    const space: GizmoSpace = {
      rect: { left: 0, top: 0, width: 1200, height: 800 },
      layoutWidth: 1200,
      layoutHeight: 800,
    }
    const d = moveDelta({ space, x: 100, y: 100 }, 220, 160)
    expect(d.dx).toBeCloseTo(120, 6)
    expect(d.dy).toBeCloseTo(60, 6)
  })

  it('survives degenerate zero-size rects without NaN', () => {
    const space: GizmoSpace = {
      rect: { left: 0, top: 0, width: 0, height: 0 },
      layoutWidth: 600,
      layoutHeight: 400,
    }
    const d = moveDelta({ space, x: 10, y: 10 }, 40, 30)
    expect(Number.isFinite(d.dx)).toBe(true)
    expect(Number.isFinite(d.dy)).toBe(true)
  })

  it('toLayoutPoint maps client coords through the frozen space', () => {
    expect(toLayoutPoint(makeSpace(0.5), 150, 125)).toEqual({ x: 300, y: 250 })
  })
})

describe('rotationDelta', () => {
  const pivot = { x: 0, y: 0 }

  it('measures quarter turns in the correct sign (screen Y grows downward)', () => {
    // Start ray along +x; current ray straight down (+y) → clockwise → +90°.
    expect(rotationDelta(0, pivot, 10, 0, 0, 10) / RAD).toBeCloseTo(90, 6)
    // Current ray up (−y) → counter-clockwise → −90°.
    expect(rotationDelta(0, pivot, 10, 0, 0, -10) / RAD).toBeCloseTo(-90, 6)
    expect(rotationDelta(0, pivot, 10, 0, -10, 0) / RAD).toBeCloseTo(180, 6)
  })

  it('works from off-axis start rays and arbitrary pivots', () => {
    const p = { x: 100, y: 50 }
    // Start ray pivot→(140,10) sits at −45° (screen Y grows downward);
    // sweeping to the pure +x ray at (180,50) is +45°.
    const startAngle = Math.atan2(10 - 50, 140 - 100)
    expect(rotationDelta(startAngle, p, 140, 10, 180, 50) / RAD).toBeCloseTo(45, 6)
    // …and to the straight-up ray at (100,-10) is a further −45° (total −90).
    expect(rotationDelta(startAngle, p, 140, 10, 100, -10) / RAD).toBeCloseTo(-45, 6)
  })

  it('wraps across the ±180° discontinuity via the shortest arc', () => {
    const at = (deg: number) => ({ x: Math.cos(deg * RAD), y: Math.sin(deg * RAD) })
    // Same-ray current position ⇒ zero sweep.
    expect(rotationDelta(170 * RAD, { x: 0, y: 0 }, 1, 1, at(170).x, at(170).y) / RAD).toBeCloseTo(
      0,
      6,
    )
    // Crossing upward: 170° → −170° sweeps +20°, not −340°.
    expect(
      rotationDelta(170 * RAD, { x: 0, y: 0 }, 1, 1, at(-170).x, at(-170).y) / RAD,
    ).toBeCloseTo(20, 6)
    // …and downward: −170° → 170° sweeps −20°.
    expect(rotationDelta(-170 * RAD, { x: 0, y: 0 }, 1, 1, at(170).x, at(170).y) / RAD).toBeCloseTo(
      -20,
      6,
    )
  })

  it('stays inside (−180°, 180°]', () => {
    for (let deg = -359; deg <= 359; deg += 7) {
      const n = normalizeAngleRad(deg * RAD)
      expect(n).toBeGreaterThan(-Math.PI - 1e-9)
      expect(n).toBeLessThanOrEqual(Math.PI + 1e-9)
    }
  })

  it('re-derives the start ray defensively when startAngleRad is not finite', () => {
    // start pointer (5,5) → 45°; current (−5,5) → 135° ⇒ +90°.
    expect(rotationDelta(Number.NaN, pivot, 5, 5, -5, 5) / RAD).toBeCloseTo(90, 6)
  })
})

describe('snapRotationToStep (Shift 15° snap)', () => {
  it('quantizes to whole 15° increments', () => {
    expect(snapRotationToStep(0)).toBe(0)
    expect(snapRotationToStep(8)).toBe(15) // nearest multiple wins
    expect(snapRotationToStep(22)).toBe(15)
    expect(snapRotationToStep(37)).toBe(30)
    expect(snapRotationToStep(89.9)).toBe(90)
  })

  it('handles negatives symmetrically and respects custom steps', () => {
    expect(snapRotationToStep(-8)).toBe(-15)
    expect(snapRotationToStep(-14)).toBe(-15)
    expect(snapRotationToStep(40, 45)).toBe(45)
    expect(snapRotationToStep(10, 0)).toBe(10) // disabled step → untouched
  })
})

describe('scaleFactor', () => {
  const pivot = { x: 100, y: 100 }

  it('is identity while the pointer sits at its grab position', () => {
    expect(scaleFactor(pivot, 100, 200, 100)).toBe(1)
  })

  it('tracks the distance ratio monotonically', () => {
    let prev = 0
    for (const d of [120, 150, 200, 260, 400]) {
      const f = scaleFactor(pivot, 100, pivot.x + d, pivot.y)
      expect(f).toBeGreaterThan(prev)
      prev = f
    }
    expect(scaleFactor(pivot, 100, 300, 100)).toBeCloseTo(2, 6)
    expect(scaleFactor(pivot, 100, 150, 100)).toBeCloseTo(0.5, 6)
  })

  it('clamps into [SCALE_MIN, SCALE_MAX]', () => {
    expect(scaleFactor(pivot, 100, 10200, 100)).toBe(20)
    expect(scaleFactor(pivot, 100, 100.5, 100)).toBe(0.05)
    expect(clampScale(50)).toBe(20)
    expect(clampScale(0.001)).toBe(0.05)
  })

  it('works with off-center pivots (only distances enter the ratio)', () => {
    const p = { x: 50, y: 250 }
    const startDist = Math.hypot(110 - 50, 250 - 250) // 60
    expect(scaleFactor(p, startDist, 230, 250)).toBeCloseTo(3, 6)
    expect(scaleFactor(p, startDist, 80, 250)).toBeCloseTo(0.5, 6)
  })

  it('degrades to no-change when the grab sat ON the pivot', () => {
    expect(scaleFactor(pivot, 0, 300, 300)).toBe(1)
    expect(scaleFactor(pivot, Number.NaN, 300, 300)).toBe(1)
  })
})

describe('resolvePivot precedence chain', () => {
  it('defaults to 50% 50%', () => {
    expect(resolvePivot({}, null)).toEqual({ xPct: 50, yPct: 50 })
  })

  it('uses the static origin field before the default', () => {
    expect(resolvePivot({ element: { origin: { x: '25%', y: '75%' } } }, null)).toEqual({
      xPct: 25,
      yPct: 75,
    })
  })

  it('prefers the origin-track value at playhead over the static field', () => {
    expect(resolvePivot({ element: { origin: { x: '25%', y: '75%' } } }, '0% 100%')).toEqual({
      xPct: 0,
      yPct: 100,
    })
  })

  it('resolves px origins against the box dimensions', () => {
    expect(
      resolvePivot({ element: { origin: { x: '20px', y: '30px' } } }, null, {
        width: 200,
        height: 100,
      }),
    ).toEqual({
      xPct: 10,
      yPct: 30,
    })
  })

  it('falls back link-by-link on unresolvable sources', () => {
    // Track value unparseable → static field answers.
    expect(resolvePivot({ element: { origin: { x: '10%', y: '20%' } } }, 'left top')).toEqual({
      xPct: 10,
      yPct: 20,
    })
    // Static field unparseable → default.
    expect(resolvePivot({ element: { origin: { x: '42abc', y: '20%' } } }, null)).toEqual({
      xPct: 50,
      yPct: 50,
    })
    // px origins need a box; without one the source is skipped.
    expect(resolvePivot({ element: { origin: { x: '20px', y: '30px' } } }, null)).toEqual({
      xPct: 50,
      yPct: 50,
    })
  })

  it('treats one-value forms as X + centered Y, per CSS defaults', () => {
    expect(resolvePivot({ element: { origin: { x: '25%', y: '25%' } } }, '25%')).toEqual({
      xPct: 25,
      yPct: 50,
    })
  })
})

describe('gizmoWritePolicy truth table', () => {
  const kfA = { id: 'a', time: 400, value: '0', easing: 'ease-out' as const }
  const kfB = { id: 'b', time: 1000, value: '1', easing: 'linear' as const }

  it('routes missing tracks to track+keyframe creation', () => {
    expect(gizmoWritePolicy(null, 500)).toEqual({ kind: 'create-track-and-kf' })
  })

  it('updates the exact-hit keyframe (epsilon inclusive)', () => {
    const track = { keyframes: [kfA, kfB] }
    expect(gizmoWritePolicy(track, 400)).toEqual({ kind: 'update-kf', kfId: 'a' })
    expect(gizmoWritePolicy(track, 400 + GIZMO_HIT_EPSILON_MS)).toEqual({
      kind: 'update-kf',
      kfId: 'a',
    })
    expect(gizmoWritePolicy(track, 400 - GIZMO_HIT_EPSILON_MS)).toEqual({
      kind: 'update-kf',
      kfId: 'a',
    })
  })

  it('falls back to creation just past the epsilon boundary', () => {
    const track = { keyframes: [kfA, kfB] }
    expect(gizmoWritePolicy(track, 400 + GIZMO_HIT_EPSILON_MS + 0.001)).toEqual({
      kind: 'create-kf',
    })
  })

  it('creates between/outside keyframes and on empty tracks', () => {
    const track = { keyframes: [kfA, kfB] }
    expect(gizmoWritePolicy(track, 700)).toEqual({ kind: 'create-kf' })
    expect(gizmoWritePolicy(track, 1500)).toEqual({ kind: 'create-kf' })
    expect(gizmoWritePolicy({ keyframes: [] }, 500)).toEqual({ kind: 'create-kf' })
  })

  it('picks the nearest hit when several keys share the window (ties → earlier)', () => {
    const near = { id: 'n1', time: 496, value: '', easing: 'linear' as const }
    const far = { id: 'n2', time: 504, value: '', easing: 'linear' as const }
    expect(gizmoWritePolicy({ keyframes: [near, far] }, 500)).toEqual({
      kind: 'update-kf',
      kfId: 'n1',
    })
    expect(gizmoWritePolicy({ keyframes: [near, far] }, 503)).toEqual({
      kind: 'update-kf',
      kfId: 'n2',
    })
  })

  it('honors a custom epsilon', () => {
    const track = { keyframes: [kfA] }
    expect(gizmoWritePolicy(track, 415, 15)).toEqual({ kind: 'update-kf', kfId: 'a' })
    expect(gizmoWritePolicy(track, 415, 10)).toEqual({ kind: 'create-kf' })
  })
})

describe('inheritEasingForNewKeyframe', () => {
  const sorted = [
    { time: 0, easing: 'linear' },
    { time: 1000, easing: 'ease-in' },
  ] as const

  it("inherits the leaving neighbor's easing", () => {
    expect(inheritEasingForNewKeyframe(sorted, 500)).toBe('linear')
    expect(inheritEasingForNewKeyframe(sorted, 1200)).toBe('ease-in')
    expect(inheritEasingForNewKeyframe(sorted, 1000)).toBe('ease-in')
  })

  it('falls back to ease-out before the first keyframe or on empty tracks', () => {
    expect(inheritEasingForNewKeyframe(sorted, -5)).toBe('ease-out')
    expect(inheritEasingForNewKeyframe([], 500)).toBe('ease-out')
    expect(inheritEasingForNewKeyframe([], 500, 'linear')).toBe('linear')
  })
})

describe('track-value parsing/formatting (legacy-function tolerant)', () => {
  it('parses canonical pairs, single lengths and legacy wrappers', () => {
    expect(parseTranslatePair('10px -2.5px')).toEqual({ x: 10, y: -2.5 })
    expect(parseTranslatePair('-40px')).toEqual({ x: -40, y: 0 })
    expect(parseTranslatePair('translate(0px, 0px)')).toEqual({ x: 0, y: 0 })
    expect(parseTranslatePair('translateX(-40px)')).toEqual({ x: -40, y: 0 })
    expect(parseTranslatePair('translateY(12px)')).toEqual({ x: 0, y: 12 })
    // Percent axes have no linear-px answer → 0 baseline (documented).
    expect(parseTranslatePair('50% 0px')).toEqual({ x: 0, y: 0 })
    expect(parseTranslatePair('none')).toEqual({ x: 0, y: 0 })
  })

  it('formats translate canonically at 0.1px precision', () => {
    expect(formatTranslate(-12.34, 5.02)).toBe('-12.3px 5px')
  })

  it('parses rotations across units, axes and legacy wrappers', () => {
    expect(parseRotateDeg('90deg')).toBe(90)
    expect(parseRotateDeg('rotate(360deg)')).toBe(360)
    expect(parseRotateDeg('rotatex(90deg)')).toBe(90)
    expect(parseRotateDeg('x 90deg')).toBe(90)
    expect(parseRotateDeg('0.5turn')).toBe(180)
    expect(parseRotateDeg('100grad')).toBeCloseTo(90, 6)
    expect(parseRotateDeg('1rad')).toBeCloseTo(180 / Math.PI, 6)
    expect(parseRotateDeg('bogus')).toBe(0)
    expect(formatRotateDeg(41.96)).toBe('42deg')
  })

  it('parses scale numbers and formats within clamp bounds', () => {
    expect(parseScaleNum('2')).toBe(2)
    expect(parseScaleNum('scale(1.5)')).toBe(1.5)
    expect(parseScaleNum('1.5 0.8')).toBe(1.5)
    expect(parseScaleNum('scalex(3)')).toBe(3)
    expect(parseScaleNum('garbage')).toBe(1)
    expect(formatScaleNum(1.23456)).toBe('1.235')
    expect(formatScaleNum(50)).toBe(String(20))
  })
})

describe('hitTestGizmo geometry', () => {
  const box = { left: 100, top: 100, width: 100, height: 100 }

  it('assigns corners their 24px targets ahead of the body', () => {
    expect(hitTestGizmo(box, 100, 100)).toBe('nw')
    expect(hitTestGizmo(box, 111, 111)).toBe('nw')
    expect(hitTestGizmo(box, 200, 100)).toBe('ne')
    expect(hitTestGizmo(box, 100, 200)).toBe('sw')
    expect(hitTestGizmo(box, 200, 200)).toBe('se')
    expect(hitTestGizmo(box, 150, 150)).toBe('body')
    expect(hitTestGizmo(box, 113, 113)).toBe('body') // outside the corner target
  })

  it('hits the rotation handle above the top edge and nothing beyond it', () => {
    const c = rotateHandleCenter(box)
    expect(c).toEqual({ x: 150, y: 78 })
    expect(hitTestGizmo(box, c.x, c.y)).toBe('rotate')
    expect(hitTestGizmo(box, c.x, c.y - 17)).toBe('rotate')
    expect(hitTestGizmo(box, c.x, c.y - 19)).toBe(null)
  })

  it('returns null outside everything', () => {
    expect(hitTestGizmo(box, 50, 50)).toBe(null)
    expect(hitTestGizmo(box, 250, 250)).toBe(null)
  })

  it('maps parts to the UX-spec cursors', () => {
    expect(cursorForPart('body')).toBe('move')
    expect(cursorForPart('nw')).toBe('nwse-resize')
    expect(cursorForPart('se')).toBe('nwse-resize')
    expect(cursorForPart('ne')).toBe('nesw-resize')
    expect(cursorForPart('sw')).toBe('nesw-resize')
    expect(cursorForPart('rotate')).toBe('grab')
  })
})
