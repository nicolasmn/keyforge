import type { RectLike } from './originMath'
import { applyPoseToBox, type GizmoPose, type Point } from './gizmoMath'

// ── Unified spatial snapping for stage gizmos (Revision 1, Part C) ─────
//
// Pure module — no DOM, no Solid coupling (same discipline as gizmoMath /
// originMath) so every rule unit-tests in node. Spec source: transform
// gizmos plan Revision 1 §C:
//
//   snapTranslate(dx, dy, opts)
//     applies IN ORDER: axis lock → alignment targets → pixel grid round.
//     Alt = no snapping at all (not even grid rounding).
//   axis lock: if |dx| AND |dy| both exceed a 3px threshold, lock to the
//     dominant axis UNLESS the pointer angle is within 45°±10° of the
//     diagonal (free diagonal movement).
//   alignmentTargets(layers, stageBox, excludeLayerId)
//     → sorted candidate arrays { x: number[], y: number[] } built from
//     other layers' POSED left/centerX/right + top/centerY/bottom plus
//     stage centerX/centerY and edges.
//   snapAxis(value, candidates, threshold = 6) → { snapped, guide }.

/** Dead-zone before axis lock considers both axes engaged (layout px). */
export const AXIS_LOCK_THRESHOLD_PX = 3
/** Half-width of the free-diagonal window around 45°. */
export const DIAGONAL_HALF_ANGLE_DEG = 10
/**
 * Default magnet distance for alignment snapping (layout px). Same order as
 * Figma's ~6px guides; deliberately NOT tied to snap.ts (time-only).
 */
export const ALIGNMENT_SNAP_PX = 6

/**
 * Sorted candidate coordinates per axis (canvas-layout px). Alignment
 * compares a mover's candidate positions against these lines.
 */
export interface AlignmentTargets {
  x: number[]
  y: number[]
}

/**
 * A layer's snap geometry: its UNtransformed reference box plus the pose
 * the preview shows for it at the playhead. alignmentTargets poses each
 * box itself via gizmoMath.applyPoseToBox so callers never duplicate that
 * math (and rotated/scaled layers yield correct posed edges).
 */
export interface SnapLayerInput {
  id: string
  box: RectLike
  pose: GizmoPose
  pivotPct?: { xPct: number; yPct: number }
}

function pushSortedUnique(values: number[], ...vs: number[]): void {
  // Snap comparisons are exact float matches by construction (targets are
  // frozen once at gesture start), but dedupe anyway so duplicated inputs
  // can't skew nearest-wins ties toward one coordinate.
  for (const v of vs) {
    if (!values.includes(v)) values.push(v)
  }
  values.sort((a, b) => a - b)
}

const DEFAULT_PIVOT = { xPct: 50, yPct: 50 }

/**
 * Candidate guide coordinates for a MOVE gesture (canvas-layout px):
 *
 *   - every OTHER visible layer's posed left / centerX / right and top /
 *     centerY / bottom — POSED positions, i.e. applyPoseToBox over each
 *     layer's own playhead pose, so guides line up with what renders;
 *   - the stage's centerX / centerY and all four edges.
 *
 * Layers whose id matches `excludeLayerId` (the layer being dragged) are
 * skipped; their own edges must never attract their gesture. Arrays come
 * back sorted ascending for deterministic nearest-wins scanning.
 */
export function alignmentTargets(
  layers: readonly SnapLayerInput[],
  stageBox: RectLike,
  excludeLayerId?: string | null,
): AlignmentTargets {
  const xs: number[] = []
  const ys: number[] = []
  for (const l of layers) {
    if (excludeLayerId != null && l.id === excludeLayerId) continue
    const geo = applyPoseToBox(l.box, l.pose, l.pivotPct ?? { ...DEFAULT_PIVOT })
    const minX = Math.min(...geo.polygon.map((p) => p.x))
    const maxX = Math.max(...geo.polygon.map((p) => p.x))
    const minY = Math.min(...geo.polygon.map((p) => p.y))
    const maxY = Math.max(...geo.polygon.map((p) => p.y))
    pushSortedUnique(xs, minX, (minX + maxX) / 2, maxX)
    pushSortedUnique(ys, minY, (minY + maxY) / 2, maxY)
  }
  // Stage center + edges always participate (aligning to canvas frame).
  pushSortedUnique(
    xs,
    stageBox.left,
    stageBox.left + stageBox.width / 2,
    stageBox.left + stageBox.width,
  )
  pushSortedUnique(
    ys,
    stageBox.top,
    stageBox.top + stageBox.height / 2,
    stageBox.top + stageBox.height,
  )
  return { x: xs, y: ys }
}

/**
 * Snap `value` to the NEAREST candidate within `threshold` px:
 *
 *   hit    → { snapped: candidate, guide: candidate }
 *   no hit → { snapped: value,      guide: null }
 *
 * Ties go to the SMALLER coordinate (arrays are sorted ascending and the
 * scan keeps strict `<`, so behavior is deterministic). Non-finite input
 * falls through untouched — callers never special-case.
 */
export function snapAxis(
  value: number,
  candidates: readonly number[],
  threshold: number = ALIGNMENT_SNAP_PX,
): { snapped: number; guide: number | null } {
  if (!Number.isFinite(value)) return { snapped: value, guide: null }
  let best: number | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  for (const c of candidates) {
    const diff = Math.abs(value - c)
    if (diff > threshold) continue
    if (diff < bestDiff || best === null) {
      best = c
      bestDiff = diff
    }
  }
  return best === null ? { snapped: value, guide: null } : { snapped: best, guide: best }
}

/**
 * Axis-lock stage of a move drag (Revision 1): once BOTH components pass
 * the 3px dead zone the drag locks to its dominant axis — unless the drag
 * direction sits within 45°±10° of the diagonal, which stays FREE so
 * deliberate diagonal moves never fight the lock. Single-axis drags (one
 * component inside the dead zone) are left alone: they are already
 * effectively locked by physics.
 *
 * Returns the (possibly zeroed) delta.
 */
export function axisLockDelta(
  dx: number,
  dy: number,
  opts: { deadZonePx?: number; diagonalHalfAngleDeg?: number } = {},
): { dx: number; dy: number } {
  const deadZone = opts.deadZonePx ?? AXIS_LOCK_THRESHOLD_PX
  const halfAngle = opts.diagonalHalfAngleDeg ?? DIAGONAL_HALF_ANGLE_DEG
  if (!(Math.abs(dx) > deadZone && Math.abs(dy) > deadZone)) return { dx, dy }
  const angleDeg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) // [0, 180]
  // Distance from the nearest 45° diagonal: diagonals repeat every 90°,
  // so folding the first-quadrant-mirrored angle into [0, 90) and taking
  // |angle − 45| measures exactly that (0 = on a diagonal).
  const distFromDiagonal = Math.abs((angleDeg % 90) - 45)
  if (distFromDiagonal <= halfAngle) return { dx, dy } // free diagonal
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy }
}

/** Mover-side candidate positions at ZERO delta (canvas-layout px). */
export interface MoverCandidates {
  /** Posed AABB left / centerX / right when dx = dy = 0. */
  x: [number, number, number]
  /** Posed AABB top / centerY / bottom when dx = dy = 0. */
  y: [number, number, number]
}

/**
 * Extract a moving layer's alignment candidates from its posed outline at
 * grab time. Translate shifts the whole polygon rigidly, so position under
 * delta d is exactly base + d — that is why snapTranslate only needs these
 * frozen triples instead of re-posing per frame.
 */
export function moverCandidatesFromPolygon(polygon: readonly Point[]): MoverCandidates {
  const minX = Math.min(...polygon.map((p) => p.x))
  const maxX = Math.max(...polygon.map((p) => p.x))
  const minY = Math.min(...polygon.map((p) => p.y))
  const maxY = Math.max(...polygon.map((p) => p.y))
  return {
    x: [minX, (minX + maxX) / 2, maxX],
    y: [minY, (minY + maxY) / 2, maxY],
  }
}

/** Result of snapTranslate: adjusted delta + active guide lines. */
export interface TranslateSnapResult {
  dx: number
  dy: number
  /** Vertical guide x-coordinate while an X alignment is active. */
  guideX: number | null
  /** Horizontal guide y-coordinate while a Y alignment is active. */
  guideY: number | null
}

export interface TranslateSnapOptions {
  /**
   * Alt disables ALL snapping — axis lock, alignment AND grid rounding —
   * giving the pointer back verbatim (spec: "Alt = no snapping at all").
   */
  alt?: boolean
  /** Enable the axis-lock stage (default true). */
  axisLock?: boolean
  /** Frozen target lines from alignmentTargets() (null disables alignment). */
  targets?: AlignmentTargets | null
  /** Mover candidate positions at zero delta (required for alignment). */
  mover?: MoverCandidates | null
  /** Magnet distance in layout px (default ALIGNMENT_SNAP_PX). */
  threshold?: number
  /**
   * Whole-pixel grid size; null disables the rounding stage. Default 1.
   * Applied AFTER alignment but NEVER to an axis that just snapped — grid
   * rounding would knock the edge off the very line it aligned to (e.g.
   * mover.left 10.4 → target 50 gives dx 39.6, rounding to 40 lands at
   * 50.4). Snapped axes keep their exact value; free axes get the grid.
   */
  grid?: number | null
}

/**
 * Unified translate snapping pipeline (Revision 1 §C):
 *
 *   alt            → identity, no guides, no rounding
 *   axis lock      → dominant-axis clamp with a 45°±10° free diagonal
 *   alignment      → per-axis nearest-target snap within `threshold`;
 *                    both axes may snap simultaneously (Figma-style)
 *   pixel grid     → whole-pixel round of whatever remains unsnapped
 */
export function snapTranslate(
  dx: number,
  dy: number,
  opts: TranslateSnapOptions = {},
): TranslateSnapResult {
  if (opts.alt || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    return { dx, dy, guideX: null, guideY: null }
  }

  let out = { dx, dy }
  if (opts.axisLock !== false) out = axisLockDelta(out.dx, out.dy)

  let guideX: number | null = null
  let guideY: number | null = null
  if (opts.targets && opts.mover) {
    const threshold = opts.threshold ?? ALIGNMENT_SNAP_PX
    // The mover's live candidate positions = frozen base + current delta.
    // Each of left/center/right independently finds its nearest line; the
    // winning line becomes BOTH the new delta correction and the guide.
    const sx = snapAxisBest(opts.mover.x, opts.targets.x, out.dx, threshold)
    if (sx) {
      // Position under delta d = base + d, so landing ON the line means
      // replacing the delta outright (NOT adding the residual — base is
      // already delta-free).
      out = { ...out, dx: sx.guide - sx.base }
      guideX = sx.guide
    }
    const sy = snapAxisBest(opts.mover.y, opts.targets.y, out.dy, threshold)
    if (sy) {
      out = { ...out, dy: sy.guide - sy.base }
      guideY = sy.guide
    }
  }

  // Distinguish "unset" (default 1px grid) from an explicit null (stage off)
  // — plain ?? would collapse null into the default and make it un-disableable.
  const grid = opts.grid === undefined ? 1 : opts.grid
  if (grid !== null && grid > 0) {
    if (guideX === null) out = { ...out, dx: Math.round(out.dx / grid) * grid }
    if (guideY === null) out = { ...out, dy: Math.round(out.dy / grid) * grid }
  }
  return { dx: out.dx, dy: out.dy, guideX, guideY }
}

/**
 * One mover axis vs its targets: try EACH mover candidate (left/center/
 * right) against the target list and keep whichever yields the smallest
 * residual after snapping — nearest-wins across the cross product, not
 * just the first candidate that fits. Returns null when nothing is within
 * threshold.
 */
function snapAxisBest(
  bases: readonly number[],
  candidates: readonly number[],
  delta: number,
  threshold: number,
): { guide: number; base: number } | null {
  let best: { guide: number; base: number; diff: number } | null = null
  for (const base of bases) {
    const r = snapAxis(base + delta, candidates, threshold)
    if (r.guide === null) continue
    const diff = Math.abs(r.snapped - (base + delta))
    if (!best || diff < best.diff) best = { guide: r.guide, base, diff }
  }
  return best ? { guide: best.guide, base: best.base } : null
}

/**
 * Scale-stage pixel snapping (Revision 1 §C): pick the uniform scale whose
 * resulting edge length is a WHOLE number of pixels on the dimension it
 * fits best. A single scalar generally cannot make both edges integral
 * (aspect ratio), so both candidates are derived and the closer one wins:
 *
 *   s_w = round(raw·W)/W   s_h = round(raw·H)/H
 *
 * Degenerate dimensions (≤ 0 or non-finite) fall through to plain
 * thousandths rounding, matching formatScaleNum's precision floor.
 */
export function snapScaleToWholeEdges(rawScale: number, width: number, height: number): number {
  const fallback = Math.round(rawScale * 1000) / 1000
  if (!Number.isFinite(rawScale) || rawScale < 0) return fallback
  const options: number[] = []
  if (Number.isFinite(width) && width > 0) {
    options.push(Math.round(rawScale * width) / width)
  }
  if (Number.isFinite(height) && height > 0) {
    options.push(Math.round(rawScale * height) / height)
  }
  if (options.length === 0) return fallback
  let best = options[0]
  for (const o of options) if (Math.abs(o - rawScale) < Math.abs(best - rawScale)) best = o
  return best
}
