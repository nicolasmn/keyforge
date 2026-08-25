import { describe, it, expect } from 'vitest'
import {
  ALIGNMENT_SNAP_PX,
  AXIS_LOCK_THRESHOLD_PX,
  alignmentTargets,
  axisLockDelta,
  moverCandidatesFromPolygon,
  snapAxis,
  snapScaleToWholeEdges,
  snapTranslate,
} from './snapSpatial'
import { applyPoseToBox } from './gizmoMath'

// ── helpers ────────────────────────────────────────────────────────────

const STAGE = { left: 0, top: 0, width: 600, height: 400 }

function layerInput(id: string, box: { left: number; top: number; width: number; height: number }) {
  return {
    id,
    box,
    pose: { tx: 0, ty: 0, rotDeg: 0, scale: 1 },
    pivotPct: { xPct: 50, yPct: 50 },
  }
}

// ── axis lock truth table ──────────────────────────────────────────────

describe('axisLockDelta', () => {
  it('leaves single-axis drags alone (one component inside the 3px dead zone)', () => {
    expect(axisLockDelta(AXIS_LOCK_THRESHOLD_PX, 40)).toEqual({ dx: 3, dy: 40 })
    expect(axisLockDelta(-2.9, -120)).toEqual({ dx: -2.9, dy: -120 })
    expect(axisLockDelta(0, 15)).toEqual({ dx: 0, dy: 15 })
    expect(axisLockDelta(80, AXIS_LOCK_THRESHOLD_PX)).toEqual({ dx: 80, dy: 3 })
  })

  it('locks to the dominant horizontal axis when the drag is flat', () => {
    // atan2(4, 60) ≈ 3.8° — far from the 45°±10° diagonal window.
    expect(axisLockDelta(60, 4)).toEqual({ dx: 60, dy: 0 })
    expect(axisLockDelta(-60, -4)).toEqual({ dx: -60, dy: 0 })
  })

  it('locks to the dominant vertical axis when the drag is steep', () => {
    // atan2(60, 4) ≈ 86° → distance from diagonal = 41° > 10°.
    expect(axisLockDelta(4, 60)).toEqual({ dx: 0, dy: 60 })
    expect(axisLockDelta(-3.5, -90)).toEqual({ dx: 0, dy: -90 })
  })

  it('keeps deliberate near-45° drags free (45°±10° window)', () => {
    expect(axisLockDelta(50, 50)).toEqual({ dx: 50, dy: 50 }) // exactly 45°
    // atan2(38, 50) ≈ 37.2° — inside [35°, 55°].
    expect(axisLockDelta(50, 38)).toEqual({ dx: 50, dy: 38 })
    // atan2(61, 50) ≈ 50.7° — inside the window from the other side.
    expect(axisLockDelta(50, 61)).toEqual({ dx: 50, dy: 61 })
    // Quadrant symmetry: mirrored drags stay free too.
    expect(axisLockDelta(-50, 52)).toEqual({ dx: -50, dy: 52 })
  })

  it('breaks the tie toward the dominant (horizontal) component on exact diagonals at the edge', () => {
    // 34.5° is outside the window; |dx| > |dy| → Y zeroed.
    expect(axisLockDelta(60, 34.5)).toEqual({ dx: 60, dy: 0 })
    // 55.5° outside; |dy| > |dx| → X zeroed.
    expect(axisLockDelta(34.5, 55.6)).toEqual({ dx: 0, dy: 55.6 })
  })

  it('honors custom dead zone and window', () => {
    expect(axisLockDelta(10, 10, { deadZonePx: 20 })).toEqual({ dx: 10, dy: 10 })
    expect(axisLockDelta(60, 30, { diagonalHalfAngleDeg: 0 })).toEqual({
      dx: 60,
      dy: 0,
    })
  })
})

// ── alignmentTargets ───────────────────────────────────────────────────

describe('alignmentTargets', () => {
  it('collects other layers’ posed edges + centers and stage center/edges, sorted ascending', () => {
    const targets = alignmentTargets(
      [layerInput('a', { left: 100, top: 50, width: 60, height: 40 })],
      STAGE,
    )
    expect(targets.x).toEqual([
      0, // stage left
      100, // layer left
      130, // layer centerX
      160, // layer right
      300, // stage centerX
      600, // stage right
    ])
    expect(targets.y).toEqual([
      0, // stage top
      50, // layer top
      70, // layer centerY
      90, // layer bottom
      200, // stage centerY
      400, // stage bottom
    ])
  })

  it('uses POSED positions for translated/rotated/scaled layers', () => {
    const box = { left: 100, top: 100, width: 60, height: 40 }
    // Translate by (25, -10): posed AABB shifts rigidly.
    const targets = alignmentTargets(
      [
        {
          id: 'a',
          box,
          pose: { tx: 25, ty: -10, rotDeg: 0, scale: 1 },
          pivotPct: { xPct: 50, yPct: 50 },
        },
      ],
      STAGE,
    )
    expect(targets.x).toContain(125)
    expect(targets.x).toContain(155)
    expect(targets.y).toContain(90)
    expect(targets.y).toContain(130)

    // Scale ×2 about center: posed AABB doubles around the same center.
    const scaled = alignmentTargets(
      [
        {
          id: 'a',
          box,
          pose: { tx: 0, ty: 0, rotDeg: 0, scale: 2 },
          pivotPct: { xPct: 50, yPct: 50 },
        },
      ],
      STAGE,
    )
    expect(scaled.x).toContain(70) // 130 − 60
    expect(scaled.x).toContain(190) // 130 + 60
    expect(scaled.y).toContain(80) // 120 − 40 (half-height doubles)
    expect(scaled.y).toContain(160) // 120 + 40

    // 90° rotation about center: AABB swaps width/height.
    const rotated = alignmentTargets(
      [
        {
          id: 'a',
          box,
          pose: { tx: 0, ty: 0, rotDeg: 90, scale: 1 },
          pivotPct: { xPct: 50, yPct: 50 },
        },
      ],
      STAGE,
    )
    // Center stays (130, 120); half-extents swap → x ∈ [110, 150], y ∈ [90, 150].
    expect(rotated.x).toContain(110)
    expect(rotated.x).toContain(150)
    expect(rotated.y).toContain(90)
    expect(rotated.y).toContain(150)
  })

  it('excludes the dragged layer but keeps its geometry out of the candidates', () => {
    const layers = [
      layerInput('dragged', { left: 10, top: 10, width: 20, height: 20 }),
      layerInput('other', { left: 300, top: 200, width: 50, height: 50 }),
    ]
    const targets = alignmentTargets(layers, STAGE, 'dragged')
    expect(targets.x).not.toContain(10)
    expect(targets.x).not.toContain(20)
    expect(targets.x).not.toContain(30)
    expect(targets.x).toContain(300)
    expect(targets.x).toContain(325)
  })

  it('is consistent with applyPoseToBox output for an off-center pivot', () => {
    const box = { left: 100, top: 100, width: 60, height: 40 }
    const geo = applyPoseToBox(
      box,
      { tx: 12, ty: 34, rotDeg: 30, scale: 1.5 },
      { xPct: 25, yPct: 75 },
    )
    const targets = alignmentTargets(
      [
        {
          id: 'a',
          box,
          pose: { tx: 12, ty: 34, rotDeg: 30, scale: 1.5 },
          pivotPct: { xPct: 25, yPct: 75 },
        },
      ],
      STAGE,
      null,
    )
    const minX = Math.min(...geo.polygon.map((p) => p.x))
    const maxX = Math.max(...geo.polygon.map((p) => p.x))
    expect(targets.x).toContain(minX)
    expect(targets.x).toContain(maxX)
    expect(targets.x).toContain((minX + maxX) / 2)
  })
})

// ── snapAxis ───────────────────────────────────────────────────────────

describe('snapAxis', () => {
  it('snaps to the nearest candidate within threshold and returns it as guide', () => {
    expect(snapAxis(96, [0, 100])).toEqual({ snapped: 100, guide: 100 })
    expect(snapAxis(4, [0, 100])).toEqual({ snapped: 0, guide: 0 })
  })

  it('respects the threshold boundary (inclusive at exactly ±threshold)', () => {
    const t = ALIGNMENT_SNAP_PX
    expect(snapAxis(100 - t, [100, 300]).guide).toBe(100)
    expect(snapAxis(100 + t, [100, 300]).guide).toBe(100)
    expect(snapAxis(100 - t - 0.001, [100, 300])).toEqual({
      snapped: 100 - t - 0.001,
      guide: null,
    })
  })

  it('falls through untouched with a null guide beyond threshold', () => {
    expect(snapAxis(50, [0, 100])).toEqual({ snapped: 50, guide: null })
  })

  it('wins nearest-first when two candidates are in range', () => {
    expect(snapAxis(97, [94, 101])).toEqual({ snapped: 94, guide: 94 })
    expect(snapAxis(99, [94, 103])).toEqual({ snapped: 103, guide: 103 })
  })

  it('breaks exact ties deterministically toward the smaller coordinate', () => {
    expect(snapAxis(97.5, [95, 100], 3)).toEqual({ snapped: 95, guide: 95 })
  })

  it('honors a custom threshold', () => {
    expect(snapAxis(10, [16], 6)).toEqual({ snapped: 16, guide: 16 })
    expect(snapAxis(10, [16], 5)).toEqual({ snapped: 10, guide: null })
  })

  it('passes non-finite values through without snapping', () => {
    expect(snapAxis(Number.NaN, [0])).toEqual({ snapped: Number.NaN, guide: null })
    expect(snapAxis(Number.POSITIVE_INFINITY, [0])).toEqual({
      snapped: Number.POSITIVE_INFINITY,
      guide: null,
    })
  })
})

// ── snapTranslate pipeline ─────────────────────────────────────────────

describe('snapTranslate', () => {
  const mover = {
    x: [100, 130, 160] as [number, number, number],
    y: [50, 70, 90] as [number, number, number],
  }
  const targets = alignmentTargets(
    [layerInput('a', { left: 300, top: 200, width: 60, height: 40 })],
    STAGE,
  )

  it('returns identity with no guides under Alt (no locking, no alignment, no grid)', () => {
    const r = snapTranslate(10.4, 22.6, { alt: true, targets, mover })
    expect(r).toEqual({ dx: 10.4, dy: 22.6, guideX: null, guideY: null })
    // Alt also beats a would-be axis lock.
    expect(snapTranslate(60, 4, { alt: true }).dy).toBe(4)
  })

  it('applies axis lock before alignment', () => {
    // Flat drag (60, 4) locks to X; alignment then snaps the right edge
    // (160+60=220 … no target) — dx stays whole via the grid stage.
    const r = snapTranslate(60, 4, { targets, mover })
    expect(r.dy).toBe(0)
    expect(r.dx).toBe(60)
    expect(r.guideY).toBeNull()
  })

  it('snaps both axes independently onto target lines and reports guides', () => {
    // Drag so the mover's right edge lands within 6px of the other layer's
    // left edge (300) AND its bottom lands within 6px of 200.
    const r = snapTranslate(136, 127, { targets, mover, axisLock: false })
    expect(r.guideX).toBe(300) // right edge 296 → snapped to 300
    expect(r.guideY).toBe(200) // centerY 197 → snapped to 200
    expect(r.dx).toBeCloseTo(140, 10) // 300 − 160 (right base)
    expect(r.dy).toBeCloseTo(130, 10) // 200 − 70 (centerY base)
  })

  it('snaps through the CENTER candidate when it wins nearest-wins', () => {
    // Mover centerX 130+dx vs stage centerX 300 → dx ≈ 170 snaps exactly.
    const r = snapTranslate(168, 0, { targets, mover })
    expect(r.guideX).toBe(300)
    expect(r.dx).toBeCloseTo(170, 10)
  })

  it('keeps aligned axes exact while rounding only free axes to the pixel grid', () => {
    // X aligns exactly (fractional correction must survive), Y stays free.
    const fractionalMover = {
      x: [10.4, 40.4, 70.4] as [number, number, number],
      y: [0, 10, 20] as [number, number, number],
    }
    const t = { x: [70] as number[], y: [500] as number[] }
    const r = snapTranslate(59.2, 33.3, {
      targets: t,
      mover: fractionalMover,
      threshold: 6,
      grid: 1,
      axisLock: false,
    })
    expect(r.guideX).toBe(70)
    expect(r.dx).toBeCloseTo(59.6, 10) // exact alignment correction
    expect(r.dy).toBe(33) // free axis rounded to the grid
  })

  it('rounds free movement to whole pixels by default', () => {
    // Single-axis drag (dy inside the dead zone → no lock): grid rounds dx.
    expect(snapTranslate(10.4, 2)).toEqual({ dx: 10, dy: 2, guideX: null, guideY: null })
    // A steep two-axis drag locks to Y first, THEN the free X is zeroed
    // and Y rounds — pipeline order made visible.
    expect(snapTranslate(10.4, 22.6)).toEqual({ dx: 0, dy: 23, guideX: null, guideY: null })
  })

  it('disables the grid stage with grid:null (alignment still active)', () => {
    const r = snapTranslate(59.2, 33.3, { grid: null, axisLock: false })
    expect(r.dx).toBeCloseTo(59.2, 10)
    expect(r.dy).toBeCloseTo(33.3, 10)
  })

  it('skips everything cleanly without targets/mover (lock + grid only)', () => {
    const r = snapTranslate(60, 4, {})
    expect(r).toEqual({ dx: 60, dy: 0, guideX: null, guideY: null })
  })

  it('passes non-finite deltas through unsnapped', () => {
    expect(snapTranslate(Number.NaN, 5)).toEqual({
      dx: Number.NaN,
      dy: 5,
      guideX: null,
      guideY: null,
    })
  })
})

// ── mover candidates ──────────────────────────────────────────────────

describe('moverCandidatesFromPolygon', () => {
  it('derives AABB triples (left/center/right, top/center/bottom) from a posed polygon', () => {
    const poly = [
      { x: 10, y: 20 },
      { x: 70, y: 20 },
      { x: 70, y: 60 },
      { x: 10, y: 60 },
    ]
    expect(moverCandidatesFromPolygon(poly)).toEqual({
      x: [10, 40, 70],
      y: [20, 40, 60],
    })
  })

  it('works on rotated outlines where corners are not axis-aligned', () => {
    const geo = applyPoseToBox(
      { left: 100, top: 100, width: 60, height: 40 },
      { tx: 0, ty: 0, rotDeg: 45, scale: 1 },
      { xPct: 50, yPct: 50 },
    )
    const c = moverCandidatesFromPolygon(geo.polygon)
    expect(c.x[0]).toBeLessThan(c.x[1])
    expect(c.x[1]).toBeLessThan(c.x[2])
    expect(c.y[0]).toBeLessThan(c.y[1])
    expect(c.y[1]).toBeLessThan(c.y[2])
  })
})

// ── scale edge rounding ────────────────────────────────────────────────

describe('snapScaleToWholeEdges', () => {
  it('picks the scale making the closer-fit dimension land whole', () => {
    // raw 1.237 · w60 = 74.22 → 74/60 ≈ 1.2333; · h40 = 49.48 → 49/40 = 1.225
    // |1.2333−1.237| < |1.225−1.237| → width wins.
    expect(snapScaleToWholeEdges(1.237, 60, 40)).toBeCloseTo(74 / 60, 12)
  })

  it('prefers height when that fit is closer', () => {
    // raw 1.26 · h40 = 50.4 → 50/40 = 1.25; · w60 = 75.6 → 76/60 ≈ 1.2667
    // |1.2667−1.26| < |1.25−1.26| → width wins here actually; use 1.255:
    // h: 50.2 → 50/40=1.25 (diff .005); w: 75.3 → 75/60=1.25 (diff .005) tie…
    // Use raw 1.51: h→60.4→60/40=1.5 (diff .01); w→90.6→91/60≈1.5167 (diff .0067).
    expect(snapScaleToWholeEdges(1.51, 60, 40)).toBeCloseTo(91 / 60, 12)
  })

  it('returns whole-pixel-safe scales for integer-friendly inputs', () => {
    expect(snapScaleToWholeEdges(2, 60, 40)).toBe(2) // 120×80 already whole
    expect(snapScaleToWholeEdges(0.5, 60, 40)).toBe(0.5)
  })

  it('falls back to thousandths rounding for degenerate dimensions', () => {
    expect(snapScaleToWholeEdges(1.23456, 0, Number.NaN)).toBe(1.235)
    expect(snapScaleToWholeEdges(1.23456, Number.POSITIVE_INFINITY, -3)).toBe(1.235)
    expect(snapScaleToWholeEdges(Number.NaN, 60, 40)).toBe(Number.NaN)
  })
})
