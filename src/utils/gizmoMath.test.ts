import { describe, it, expect } from 'vitest'
import {
  IDENTITY_GIZMO_POSE,
  GIZMO_HIT_EPSILON_MS,
  applyPoseToBox,
  clampScale,
  combineGizmoPoses,
  cursorForPart,
  formatRotateDeg,
  formatScaleNum,
  formatTranslate,
  gizmoWritePolicy,
  hitTestGizmo,
  inheritEasingForNewKeyframe,
  moveDelta,
  normalizeAngleRad,
  parseCompositeTransform,
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

describe('parseCompositeTransform', () => {
  const pose = (tx: number, ty: number, rotDeg: number, scale: number) => ({
    tx,
    ty,
    rotDeg,
    scale,
  })

  it('parses a lone translateY', () => {
    expect(parseCompositeTransform('translateY(40px)')).toEqual(pose(0, 40, 0, 1))
    expect(parseCompositeTransform('translateY(-12.5px)')).toEqual(pose(0, -12.5, 0, 1))
  })

  it('sums translate + rotate combos into one pose', () => {
    expect(parseCompositeTransform('translateY(40px) rotate(45deg)')).toEqual(pose(0, 40, 45, 1))
    // Order-independent accumulation: same result, reversed chain.
    expect(parseCompositeTransform('rotate(45deg) translateY(40px)')).toEqual(pose(0, 40, 45, 1))
  })

  it('sums multiple translations across function forms', () => {
    expect(parseCompositeTransform('translate(10px, -5px) translateX(-2px)')).toEqual(
      pose(8, -5, 0, 1),
    )
    expect(parseCompositeTransform('translateX(-60px) translateX(120px)')).toEqual(
      pose(60, 0, 0, 1),
    )
  })

  it('multiplies scales; scaleX+scaleY(2,2) matches uniform scale(2)', () => {
    expect(parseCompositeTransform('scale(2)')).toEqual(pose(0, 0, 0, 2))
    expect(parseCompositeTransform('scaleX(2) scaleY(2)')).toEqual(pose(0, 0, 0, 2))
    // Lone-axis factors are anisotropic under the uniform pose model → they
    // collapse to the area-preserving uniform approximation like any mixed chain.
    expect(parseCompositeTransform('scaleX(3)')?.scale).toBeCloseTo(Math.sqrt(3), 6)
    expect(parseCompositeTransform('scaleY(0.5)')?.scale).toBeCloseTo(Math.sqrt(0.5), 6)
    // Chains multiply per axis.
    expect(parseCompositeTransform('scale(2) scale(1.5)')?.scale).toBeCloseTo(3, 9)
    // Two-argument scale(sx, sy) accumulates per axis (→ area-preserving collapse).
    expect(parseCompositeTransform('scale(2, 4)')?.scale).toBeCloseTo(Math.sqrt(8), 6)
    // Anisotropic chains collapse to a documented area-preserving uniform
    // approximation (geometric mean with net sign) — pinned here so the
    // simplification is explicit.
    expect(parseCompositeTransform('scaleX(2) scaleY(3)')?.scale).toBeCloseTo(Math.sqrt(6), 6)
    expect(parseCompositeTransform('scale(2, 0.5)')?.scale).toBeCloseTo(1, 6)
  })

  it('converts turn/rad/grad rotation units and sums across functions', () => {
    expect(parseCompositeTransform('rotate(0.5turn)')?.rotDeg).toBeCloseTo(180, 6)
    expect(parseCompositeTransform('rotate(1rad)')?.rotDeg).toBeCloseTo(180 / Math.PI, 6)
    expect(parseCompositeTransform('rotate(100grad)')?.rotDeg).toBeCloseTo(90, 6)
    expect(parseCompositeTransform('rotate(30deg) rotate(0.25turn)')?.rotDeg).toBeCloseTo(120, 6)
    expect(parseCompositeTransform('rotate(-90deg) rotate(45deg)')?.rotDeg).toBeCloseTo(-45, 6)
  })

  it('composes long multi-function chains additively/multiplicatively', () => {
    expect(
      parseCompositeTransform(
        'translateX(10px) rotate(90deg) scale(2) translateY(4px) translateZ(30px)',
      ),
    ).toEqual(pose(10, 4, 90, 2))
  })

  it('validates then drops translateZ (projects away in 2D)', () => {
    expect(parseCompositeTransform('translateY(12px) translateZ(30px)')).toEqual(pose(0, 12, 0, 1))
    // But a malformed Z argument still poisons the chain.
    expect(parseCompositeTransform('translateZ(bogus)')).toBe(null)
  })

  it('treats percent/other-unit lengths as 0 contribution (Phase-1 limitation)', () => {
    // Same documented convention as parseTranslatePair: % has no linear-px
    // answer without box context; it must not null out the rest of the chain.
    expect(parseCompositeTransform('translate(50%, 20px)')).toEqual(pose(0, 20, 0, 1))
    expect(parseCompositeTransform('translateX(50%) translateY(8px)')).toEqual(pose(0, 8, 0, 1))
  })

  it('is case-insensitive on function names and units', () => {
    expect(parseCompositeTransform('TRANSLATEY(40PX) ROTATE(45DEG)')).toEqual(pose(0, 40, 45, 1))
    expect(parseCompositeTransform('Scale(2) ScaleX(1.5)')?.scale).toBeCloseTo(Math.sqrt(6), 6)
  })

  it('returns null for unknown functions — including mixed into valid chains', () => {
    expect(parseCompositeTransform('bogusFn(3px)')).toBe(null)
    expect(parseCompositeTransform('perspective(100px)')).toBe(null)
    expect(parseCompositeTransform('rotateX(45deg)')).toBe(null)
    expect(parseCompositeTransform('rotateY(45deg)')).toBe(null)
    expect(parseCompositeTransform('rotateZ(45deg)')).toBe(null)
    expect(parseCompositeTransform('translateY(10px) bogusFn(1px)')).toBe(null)
  })

  it('returns null for skew — explicitly out of scope', () => {
    expect(parseCompositeTransform('skew(10deg, 5deg)')).toBe(null)
    expect(parseCompositeTransform('skewX(15deg)')).toBe(null)
    expect(parseCompositeTransform('skewY(15deg)')).toBe(null)
    expect(parseCompositeTransform('translateY(40px) skewX(15deg)')).toBe(null)
  })

  it('returns null for matrix/matrix3d — explicitly out of scope', () => {
    expect(parseCompositeTransform('matrix(1, 0, 0, 1, 10, 20)')).toBe(null)
    expect(
      parseCompositeTransform('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1)'),
    ).toBe(null)
    expect(parseCompositeTransform('translateY(10px) matrix(1, 0, 0, 1, 10, 20)')).toBe(null)
  })

  it('returns null for empty / none / unparseable input (identity-ish fallback)', () => {
    expect(parseCompositeTransform('')).toBe(null)
    expect(parseCompositeTransform('   ')).toBe(null)
    expect(parseCompositeTransform('none')).toBe(null)
    expect(parseCompositeTransform('NONE')).toBe(null)
    expect(parseCompositeTransform('garbage')).toBe(null)
    // Trailing junk after valid functions is untrustworthy → whole value null.
    expect(parseCompositeTransform('translateY(40px) garbage')).toBe(null)
    // Unbalanced parens / malformed args / invalid arg shapes.
    expect(parseCompositeTransform('translateY(40px')).toBe(null)
    expect(parseCompositeTransform('translateY()')).toBe(null)
    expect(parseCompositeTransform('translateY(abc)')).toBe(null)
    expect(parseCompositeTransform('rotate(45)')).toBe(null) // bare angle invalid
    expect(parseCompositeTransform('scale(2px)')).toBe(null) // scale args are unitless
    expect(parseCompositeTransform('translate(10px 20px)')).toBe(null) // needs comma
    expect(parseCompositeTransform('translate()')).toBe(null)
    expect(parseCompositeTransform('translateY(40px) rotate(45deg) extra')).toBe(null)
  })

  it('keeps exact uniform negative (mirrored) scales', () => {
    expect(parseCompositeTransform('scale(-1)')).toEqual(pose(0, 0, 0, -1))
    expect(parseCompositeTransform('scaleX(-2) scaleY(-2)')).toEqual(pose(0, 0, 0, -2))
    expect(parseCompositeTransform('scale(0)')).toEqual(pose(0, 0, 0, 0))
  })

  it('accepts adjacent functions without separators (valid CSS)', () => {
    expect(parseCompositeTransform('translateX(10px)rotate(90deg)')).toEqual(pose(10, 0, 90, 1))
    expect(parseCompositeTransform('scale(2)rotate(45deg)')).toEqual(pose(0, 0, 45, 2))
    expect(parseCompositeTransform('translateY(4px)  rotate(45deg)\n')).toEqual(pose(0, 4, 45, 1))
  })

  it('never throws on pathological input', () => {
    for (const v of [
      'translateY(1e309px)', // overflows to Infinity → unparseable
      '(((((',
      '))))',
      'rotate(rad)',
      'translateY(40px))',
      'calc(100% - 10px)',
    ]) {
      const p = parseCompositeTransform(v)
      if (p !== null) {
        expect(Number.isFinite(p.tx)).toBe(true)
        expect(Number.isFinite(p.ty)).toBe(true)
        expect(Number.isFinite(p.rotDeg)).toBe(true)
        expect(Number.isFinite(p.scale)).toBe(true)
      }
    }
    expect(parseCompositeTransform('translateY(1e309px)')).toBe(null)
  })
})

describe('combineGizmoPoses (individual ⊕ composite)', () => {
  it('sums tx/ty/rotDeg and multiplies scale', () => {
    expect(
      combineGizmoPoses(
        { tx: 10, ty: -4, rotDeg: 15, scale: 2 },
        { tx: -3, ty: 40, rotDeg: 45, scale: 0.5 },
      ),
    ).toEqual({ tx: 7, ty: 36, rotDeg: 60, scale: 1 })
  })

  it('has IDENTITY_GIZMO_POSE as an exact neutral element', () => {
    // Guarantees the composite path cannot perturb layers without a usable
    // transform-track value — the no-composite behavior stays byte-identical.
    const base = { tx: 12, ty: -8, rotDeg: 33, scale: 2.5 }
    expect(combineGizmoPoses(base, { ...IDENTITY_GIZMO_POSE })).toEqual(base)
    expect(combineGizmoPoses({ ...IDENTITY_GIZMO_POSE }, base)).toEqual(base)
  })
})

describe('applyPoseToBox golden case (composite-derived pose)', () => {
  // Reference box 100×50 at (100, 50); center pivot O = (150, 75). The pose
  // comes straight from parseCompositeTransform("translateY(40px) rotate(90deg)")
  // = {tx: 0, ty: 40, rotDeg: 90, scale: 1}. With θ=90°: cos=0, sin=1, so
  // xf(px,py) = (150 − dy, 115 + dx) where d = p − O.
  const box = { left: 100, top: 50, width: 100, height: 50 }
  const parsed = parseCompositeTransform('translateY(40px) rotate(90deg)')
  it('places rotated+translated corners exactly where CSS would', () => {
    expect(parsed).toEqual({ tx: 0, ty: 40, rotDeg: 90, scale: 1 })
    const geo = applyPoseToBox(box, parsed!, { xPct: 50, yPct: 50 })
    expect(geo.corners.map((c) => ({ part: c.part, x: c.x, y: c.y }))).toEqual([
      { part: 'nw', x: 175, y: 65 },
      { part: 'ne', x: 175, y: 165 },
      { part: 'se', x: 125, y: 165 },
      { part: 'sw', x: 125, y: 65 },
    ])
    // Stem starts at the transformed top-edge midpoint…
    expect(geo.stemBase).toEqual({ x: 175, y: 115 })
    // …and "up" after a +90° rotation points screen-right (+x), STEM_LEN px out.
    expect(geo.rotateCenter).toEqual({ x: 197, y: 115 })
    // Polygon mirrors corner order for drawing/hit-testing.
    expect(geo.polygon).toEqual([
      { x: 175, y: 65 },
      { x: 175, y: 165 },
      { x: 125, y: 165 },
      { x: 125, y: 65 },
    ])
  })
})
