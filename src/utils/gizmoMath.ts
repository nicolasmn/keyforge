import type { Keyframe, Track } from '@/types'
import type { RectLike } from './originMath'
import { splitOriginComponent } from './originMath'
import { toCssPropertyValue } from './propertyRegistry'

// ── Transform gizmo math & policy ─────────────────────────────────────
// Pure functions (no DOM, no Solid coupling) mirroring originMath's
// discipline: everything the stage overlay (components/TransformOverlay.tsx)
// computes during a move/rotate/scale gesture lives here so it unit-tests in
// node. Spec source: docs/plans/2026-08-25-transform-gizmos.md §2/§3/§4/§5,
// as amended by the owner's approved Phase-1 defaults (2026-08-25):
// auto-key always on · individual properties only · hover-gated visibility ·
// no spatial snapping · corner handles only.

/** Canvas-layout-space point (pre-scale, pre-transform px). */
export interface Point {
  x: number
  y: number
}

/**
 * One consistent measurement space for pointer→layout conversion.
 *
 * `rect` is the overlay surface's CLIENT box (lives in --preview-scale'd
 * pixels); `layoutWidth/Height` are offsetWidth/offsetHeight of the SAME
 * node (unscaled canvas-layout px). Dividing client offsets by the rect and
 * multiplying by the layout size makes ancestor zoom cancel exactly — the
 * same two-hop ratio OriginOverlay.rawPct uses.
 */
export interface GizmoSpace {
  rect: RectLike
  layoutWidth: number
  layoutHeight: number
}

/**
 * Snapshot taken at pointerdown for a MOVE gesture: the frozen measurement
 * space plus the pointer position in client px.
 */
export interface MoveStart extends Point {
  space: GizmoSpace
}

/** Uniform scale bounds (plan §5 clamp). */
export const SCALE_MIN = 0.05
export const SCALE_MAX = 20

/** Playhead↔keyframe "exact hit" tolerance (timeline diamond-pick parity). */
export const GIZMO_HIT_EPSILON_MS = 8

// ── Pointer conversion ────────────────────────────────────────────────

/**
 * Client px → canvas-layout px. Ratio-based and therefore scale-invariant:
 * numerator and denominator are measured in the SAME scaled space, so the
 * result equals unscaled layout coordinates regardless of --preview-scale.
 */
export function toLayoutPoint(space: GizmoSpace, clientX: number, clientY: number): Point {
  const w = space.rect.width > 0 ? space.rect.width : 1
  const h = space.rect.height > 0 ? space.rect.height : 1
  return {
    x: ((clientX - space.rect.left) / w) * space.layoutWidth,
    y: ((clientY - space.rect.top) / h) * space.layoutHeight,
  }
}

/**
 * Translation delta for a body drag, in LAYOUT px (1 layout px = 1 CSS px on
 * the reference box — the value unit translate tracks store).
 *
 * Scale-invariance: measuring the same physical drag through a differently
 * scaled surface yields identical layout deltas, because both endpoints are
 * converted through the SAME frozen snapshot space.
 */
export function moveDelta(
  start: MoveStart,
  curX: number,
  curY: number,
): { dx: number; dy: number } {
  const a = toLayoutPoint(start.space, start.x, start.y)
  const b = toLayoutPoint(start.space, curX, curY)
  return { dx: b.x - a.x, dy: b.y - a.y }
}

// ── Rotation ──────────────────────────────────────────────────────────

/** Normalize an angle (radians) into (−π, π] — shortest signed arc. */
export function normalizeAngleRad(rad: number): number {
  // atan2 returns exactly this range; feed it sin/cos of the raw delta so
  // multi-turn inputs wrap deterministically instead of drifting.
  return Math.atan2(Math.sin(rad), Math.cos(rad))
}

/** Angle of the ray pivot→(x,y), radians. */
export function pointerAngleRad(pivot: Point, x: number, y: number): number {
  return Math.atan2(y - pivot.y, x - pivot.x)
}

/**
 * Signed rotation swept from the gesture-start pointer ray to the current
 * pointer ray around `pivotLayout`, in RADIANS, normalized to (−180°, 180°].
 *
 * The caller accumulates: newValueDeg = startTrackDeg + delta·180/π each
 * frame (never re-measured from the DOM mid-gesture — plan §5).
 *
 * `startAngleRad` is the start ray captured once at grab (pointerAngleRad);
 * startX/startY re-derive it defensively when NaN/±∞ sneaks in, keeping the
 * function total. When the start ray IS the current ray (first frame) the
 * result is 0.
 */
export function rotationDelta(
  startAngleRad: number,
  pivotLayout: Point,
  startX: number,
  startY: number,
  curX: number,
  curY: number,
): number {
  const base = Number.isFinite(startAngleRad)
    ? startAngleRad
    : pointerAngleRad(pivotLayout, startX, startY)
  return normalizeAngleRad(pointerAngleRad(pivotLayout, curX, curY) - base)
}

/**
 * Shift-modifier snap: quantize an absolute rotation (degrees) to whole
 * `stepDeg` increments (15° per plan §3 / DevTools-AE convention).
 * Negative-safe via symmetric rounding; step ≤ 0 falls through untouched.
 */
export function snapRotationToStep(valueDeg: number, stepDeg = 15): number {
  if (!(stepDeg > 0)) return valueDeg
  return Math.round(valueDeg / stepDeg) * stepDeg
}

// ── Scale ─────────────────────────────────────────────────────────────

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

/**
 * Uniform scale factor: distance(pivot→current) / distance(pivot→start),
 * clamped to [SCALE_MIN, SCALE_MAX]. Off-center pivots work by construction
 * (only distances enter the ratio). Degenerate starts (pointer ON the pivot
 * at grab, or non-finite input) return 1 — no change — instead of ±Infinity.
 */
export function scaleFactor(
  pivotLayout: Point,
  startDist: number,
  curX: number,
  curY: number,
): number {
  if (!Number.isFinite(startDist) || startDist <= 0) return 1
  const curDist = distance(pivotLayout.x, pivotLayout.y, curX, curY)
  const ratio = curDist / startDist
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, ratio))
}

// ── Pivot resolution (plan §2 precedence chain) ───────────────────────

/** Resolved transform-origin as percentages along the element's own axes. */
export interface PivotPct {
  xPct: number
  yPct: number
}

interface OriginCarrier {
  element?: { origin?: { x: string; y: string } }
}

const DEFAULT_PIVOT: PivotPct = { xPct: 50, yPct: 50 }

/** Parse ONE origin component ('25%', '-4px', …) to % along its axis. */
function originComponentToPct(component: string, dimension: number): number | null {
  const parsed = splitOriginComponent(component)
  if (!parsed) return null
  const n = Number.parseFloat(parsed.num)
  if (Number.isNaN(n)) return null
  switch (parsed.unit) {
    case '%':
      return n
    case 'px':
      // Length origins resolve against the border box (same convention as
      // originMath.resolveOriginComponent); dimension ≤ 0 can't resolve.
      return dimension > 0 ? (n / dimension) * 100 : null
    default:
      // em/rem/vw/vh pivots need font/viewport context the pure layer
      // deliberately doesn't touch — defensive fallback to center.
      return null
  }
}

/**
 * Resolve the rotation/scale PIVOT for a layer (plan §2):
 *   origin-track value at playhead  >  static origin field  >  '50% 50%'.
 *
 * `originTrackValueAtPlayhead` is the interpolated track value (or null when
 * the layer has no origin track — none exists in today's data model, but the
 * resolver owns the full precedence chain so callers never special-case).
 * Components resolve against `box` dimensions when lengths are involved;
 * anything unparseable falls back to center per-axis, matching originMath's
 * invalid→center convention. One-value forms put Y at center (CSS default).
 */
export function resolvePivot(
  layer: OriginCarrier,
  originTrackValueAtPlayhead: string | null,
  box?: { width: number; height: number },
): PivotPct {
  const w = box?.width ?? 0
  const h = box?.height ?? 0
  // Precedence chain (plan §2). A source that fails to parse is skipped so
  // the next link takes over, ending at the CSS default center.
  const staticOrigin = layer.element?.origin
  const sources: Array<string | null> = [
    originTrackValueAtPlayhead,
    staticOrigin ? `${staticOrigin.x} ${staticOrigin.y}` : null,
  ]
  for (const source of sources) {
    if (!source) continue
    const parts = source.trim().split(/\s+/)
    const x = originComponentToPct(parts[0] ?? '', w)
    if (x === null) continue
    // One-value form: X applies, Y stays at center (CSS default).
    const y = parts.length > 1 && parts[1] !== undefined ? originComponentToPct(parts[1], h) : 50
    if (y === null) continue
    return { xPct: x, yPct: y }
  }
  return { ...DEFAULT_PIVOT }
}

// ── Hit-testing geometry ──────────────────────────────────────────────

/** Which gizmo affordance owns a point (canvas-layout px). */
export type GizmoPart = 'rotate' | 'nw' | 'ne' | 'sw' | 'se' | 'body'

/** Corner hit-target side (≥24px per UX spec); glyphs stay small. */
export const CORNER_HIT_PX = 24
/**
 * VISUAL corner glyph side (Revision 1 §B): restrained Illustrator-style
 * 8px squares inside the ≥24px hit targets. Purely presentational — the
 * hit-test geometry above never reads this.
 */
export const CORNER_GLYPH_PX = 8
/** Visual rotation-handle radius. */
export const ROTATE_HANDLE_R = 8
/** Rotation hit radius (generous target on top of the 12px glyph). */
export const ROTATE_HIT_R = 18
/** Stem length: box top edge → rotation handle center (layout px). */
export const STEM_LEN = 22

/** Center of the rotation handle for a reference box. */
export function rotateHandleCenter(box: RectLike): Point {
  return { x: box.left + box.width / 2, y: box.top - STEM_LEN }
}

/**
 * Hit-test a canvas-layout point against the gizmo geometry drawn for
 * `box`: 24px corner targets first, then the rotation-handle circle above
 * the top edge, then the box body (move). Null = outside everything.
 */
export function hitTestGizmo(box: RectLike, x: number, y: number): GizmoPart | null {
  const half = CORNER_HIT_PX / 2
  const corners: Array<[GizmoPart, number, number]> = [
    ['nw', box.left, box.top],
    ['ne', box.left + box.width, box.top],
    ['sw', box.left, box.top + box.height],
    ['se', box.left + box.width, box.top + box.height],
  ]
  for (const [part, cx, cy] of corners) {
    if (Math.abs(x - cx) <= half && Math.abs(y - cy) <= half) return part
  }
  const c = rotateHandleCenter(box)
  if (distance(c.x, c.y, x, y) <= ROTATE_HIT_R) return 'rotate'
  if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) {
    return 'body'
  }
  return null
}

/** Cursor for a hovered part (body = move, corners = resize axes). */
export function cursorForPart(part: GizmoPart): string {
  switch (part) {
    case 'nw':
    case 'se':
      return 'nwse-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    case 'rotate':
      return 'grab'
    case 'body':
      return 'move'
  }
}

// ── Track value parsing / formatting ──────────────────────────────────
// Tracks may carry LEGACY function-form values (`translate(0px, 0px)` — see
// DEFAULT_FIRST_VALUE) which toCssPropertyValue normalizes only at emission;
// parsing normalizes first so gestures read either shape, while WRITES emit
// canonical individual-property syntax exclusively.

const TRANSLATE_PAIR_RE = /^(-?\d*\.?\d+)px\s+(-?\d*\.?\d+)px$/
const TRANSLATE_SINGLE_RE = /^(-?\d*\.?\d+)px$/

/**
 * Start pose of a translate track value, in px. Handles canonical pairs
 * ('10px -2px'), single-length forms ('10px' → y=0) and legacy function
 * shapes via normalization. Percent/em/… axes have no linear px answer for
 * free drags → treated as 0 baseline (documented Phase-1 limitation).
 */
export function parseTranslatePair(value: string): { x: number; y: number } {
  const v = toCssPropertyValue('translate', value.trim())
  const pair = TRANSLATE_PAIR_RE.exec(v)
  if (pair) return { x: Number.parseFloat(pair[1]), y: Number.parseFloat(pair[2]) }
  const single = TRANSLATE_SINGLE_RE.exec(v)
  if (single) return { x: Number.parseFloat(single[1]), y: 0 }
  return { x: 0, y: 0 }
}

/** Format translate back to canonical individual syntax. */
export function formatTranslate(x: number, y: number): string {
  return `${round1(x)}px ${round1(y)}px`
}

/**
 * Start rotation in DEGREES. Accepts bare angles ('45deg'), rad/turn/grad,
 * axis-prefixed individual forms ('x 90deg') and legacy rotate() wrappers.
 * Non-finite results fall back to 0.
 */
export function parseRotateDeg(value: string): number {
  const v = toCssPropertyValue('rotate', value.trim())
  const m = /^(?:[xyz]\s+)?(-?\d*\.?\d+)(deg|grad|rad|turn)$/i.exec(v)
  if (!m || m[1] === undefined || m[2] === undefined) return 0
  const n = Number.parseFloat(m[1])
  if (Number.isNaN(n)) return 0
  switch (m[2].toLowerCase()) {
    case 'deg':
      return n
    case 'grad':
      return (n * 360) / 400
    case 'rad':
      return (n * 180) / Math.PI
    case 'turn':
      return n * 360
    default:
      return 0
  }
}

/** Format rotation back to canonical bare-angle syntax. */
export function formatRotateDeg(deg: number): string {
  return `${round1(deg)}deg`
}

/**
 * Start uniform scale (first number component). Accepts bare numbers ('2'),
 * two-number forms ('1.5 0.8') and legacy scale()/scalex()/scaley().
 * Non-parseable values fall back to 1.
 */
export function parseScaleNum(value: string): number {
  const v = toCssPropertyValue('scale', value.trim())
  const m = /^-?\d*\.?\d+/.exec(v)
  if (!m || m[0] === '') return 1
  const n = Number.parseFloat(m[0])
  return Number.isNaN(n) ? 1 : n
}

/** Clamp a final uniform scale into the gizmo's usable range. */
export function clampScale(value: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value))
}

/** Format scale back to canonical single-number syntax. */
export function formatScaleNum(value: number): string {
  return String(Math.round(clampScale(value) * 1000) / 1000)
}

function round1(n: number): string {
  return String(Math.round(n * 10) / 10)
}

// ── Auto-key write policy (plan §4) ───────────────────────────────────

/**
 * Where a gizmo write lands, decided PURELY from track state + playhead:
 *
 *   { kind: 'update-kf', kfId }     playhead exactly on an existing keyframe
 *                                   (within ±GIZMO_HIT_EPSILON_MS)
 *   { kind: 'create-kf' }           track exists, playhead between/outside kfs
 *   { kind: 'create-track-and-kf' } no track yet (auto-key creates one)
 */
export type GizmoWritePlan =
  { kind: 'update-kf'; kfId: string } | { kind: 'create-kf' } | { kind: 'create-track-and-kf' }

/**
 * Pick the exact-hit keyframe: nearest |kf.time − playhead| within epsilon;
 * ties go to the EARLIER keyframe so behavior stays deterministic.
 */
export function gizmoWritePolicy(
  track: Pick<Track, 'keyframes'> | null,
  playheadMs: number,
  epsilonMs: number = GIZMO_HIT_EPSILON_MS,
): GizmoWritePlan {
  if (!track) return { kind: 'create-track-and-kf' }
  let best: Keyframe | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  for (const kf of track.keyframes) {
    const diff = Math.abs(kf.time - playheadMs)
    if (diff > epsilonMs) continue
    if (!best || diff < bestDiff || (diff === bestDiff && kf.time < best.time)) {
      best = kf
      bestDiff = diff
    }
  }
  return best ? { kind: 'update-kf', kfId: best.id } : { kind: 'create-kf' }
}

/**
 * Easing a NEW keyframe inherits: the LEAVING neighbor's (the latest kf at
 * or before the playhead — it owns the segment leaving toward the new stop).
 * No neighbor → `fallback` ('ease-out', matching "+ KF" capture workflow).
 * Expects `sortedKeyframes` ascending by time.
 */
export function inheritEasingForNewKeyframe(
  sortedKeyframes: readonly Pick<Keyframe, 'time' | 'easing'>[],
  playheadMs: number,
  fallback: Keyframe['easing'] = 'ease-out',
): Keyframe['easing'] {
  let leaving: Pick<Keyframe, 'time' | 'easing'> | null = null
  for (const kf of sortedKeyframes) {
    if (kf.time > playheadMs) break
    leaving = kf
  }
  return leaving ? leaving.easing : fallback
}

// ── Pose composition (owner feedback 2026-08-25) ───────────────────────
// Handles must sit ON the transformed element, not its reference box: when
// translate/rotate/scale tracks animate the layer, the gizmo composes the
// current pose (interpolatedValueAt at playhead) over the offset-box geometry.

/** The animated pose the preview shows for a layer at the playhead. */
export interface GizmoPose {
  tx: number
  ty: number
  rotDeg: number
  scale: number
}

export interface PosedGizmoGeometry {
  corners: Array<{ part: GizmoPart; x: number; y: number }>
  /** Top-edge midpoint after transform — stem starts here. */
  stemBase: Point
  /** Rotation handle center (stem end, rotated with the box). */
  rotateCenter: Point
  /** Transformed outline in draw order (nw → ne → se → sw). */
  polygon: Point[]
}

/**
 * Compose CSS's individual-transform chain over the reference box:
 * screen(p) = O + t + R(θ)·S·(p − O), where O is the transform-origin
 * resolved against the UNtransformed border box (css-transforms-2: origin
 * is fixed before any function applies; translate moves it on screen).
 */
export function applyPoseToBox(
  box: RectLike,
  pose: GizmoPose,
  pivotPct: { xPct: number; yPct: number },
): PosedGizmoGeometry {
  const O = {
    x: box.left + (pivotPct.xPct / 100) * box.width,
    y: box.top + (pivotPct.yPct / 100) * box.height,
  }
  const th = (pose.rotDeg * Math.PI) / 180
  const cos = Math.cos(th)
  const sin = Math.sin(th)
  const xf = (px: number, py: number): Point => {
    const dx = px - O.x
    const dy = py - O.y
    return {
      x: O.x + pose.tx + (dx * cos - dy * sin) * pose.scale,
      y: O.y + pose.ty + (dx * sin + dy * cos) * pose.scale,
    }
  }
  const corners: Array<{ part: GizmoPart; x: number; y: number }> = [
    { part: 'nw', ...xf(box.left, box.top) },
    { part: 'ne', ...xf(box.left + box.width, box.top) },
    { part: 'se', ...xf(box.left + box.width, box.top + box.height) },
    { part: 'sw', ...xf(box.left, box.top + box.height) },
  ]
  const stemBase = xf(box.left + box.width / 2, box.top)
  // Up vector after rotation: R(θ)·(0,−1) = (sinθ, −cosθ).
  const rotateCenter = {
    x: stemBase.x + STEM_LEN * sin,
    y: stemBase.y - STEM_LEN * cos,
  }
  return {
    corners,
    stemBase,
    rotateCenter,
    polygon: corners.map((c) => ({ x: c.x, y: c.y })),
  }
}

function pointInPolygon(poly: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Hit-test against POSED geometry: corner targets first, then the rotated
 * stem tip, then point-in-polygon body. Null = outside everything.
 */
export function hitTestGizmoPosed(geo: PosedGizmoGeometry, x: number, y: number): GizmoPart | null {
  const half = CORNER_HIT_PX / 2
  for (const c of geo.corners) {
    if (Math.abs(x - c.x) <= half && Math.abs(y - c.y) <= half) return c.part
  }
  if (distance(geo.rotateCenter.x, geo.rotateCenter.y, x, y) <= ROTATE_HIT_R) return 'rotate'
  if (pointInPolygon(geo.polygon, x, y)) return 'body'
  return null
}

// ── Composite `transform` track parsing (read-only geometry) ──────────
// Composite transform TRACK values ("translateY(40px)", "translateY(40px)
// rotate(45deg)") were invisible to the gizmos: outlines/handles/hit-tests
// sat on the reference box while the element rendered elsewhere (owner bug
// report). These helpers PARSE such values into a GizmoPose so every pose
// consumer draws composed geometry. Read-only by design — writes stay on
// individual-property tracks; mapping gestures onto transformStack
// functions remains Phase 3.

/**
 * The no-op pose. Missing/unparseable inputs contribute nothing: combining
 * any pose with this one is an exact identity (see combineGizmoPoses).
 */
export const IDENTITY_GIZMO_POSE: Readonly<GizmoPose> = Object.freeze({
  tx: 0,
  ty: 0,
  rotDeg: 0,
  scale: 1,
})

/**
 * Combine two poses the way CSS stacks transform SOURCES:
 * translations and rotations SUM; scales MULTIPLY; identity is neutral on
 * all four channels.
 *
 * Documented simplification: css-transforms-2 orders sources as
 * translate · rotate · scale · <transform-property>, and INSIDE the
 * transform property the function list applies left-to-right, so
 * "rotate(90deg) translateX(10px)" ≠ "translateX(10px) rotate(90deg)".
 * Summing/multiplying deliberately ignores that order — exact for
 * kind-pure chains (only translates, only rotations, only scales), a
 * close approximation otherwise. Good enough for gizmo chrome; never
 * used to produce written values.
 */
export function combineGizmoPoses(base: GizmoPose, extra: GizmoPose): GizmoPose {
  return {
    tx: base.tx + extra.tx,
    ty: base.ty + extra.ty,
    rotDeg: base.rotDeg + extra.rotDeg,
    scale: base.scale * extra.scale,
  }
}

/** One `fn(args)` span inside a composite transform value. */
const COMPOSITE_FN_RE = /([a-zA-Z][a-zA-Z0-9]*)\(([^()]*)\)/g

/** `<number><unit>` token ('40px', '-1.5turn', '2', '50%'). */
const NUMBER_UNIT_RE = /^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Z%]*)$/

function parseNumberUnit(arg: string): { n: number; unit: string } | null {
  const m = NUMBER_UNIT_RE.exec(arg.trim())
  if (!m || m[1] === undefined || m[2] === undefined) return null
  const n = Number.parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  return { n, unit: m[2] }
}

/**
 * Angle argument → degrees. Accepts deg/grad/rad/turn (case-insensitive);
 * anything else is unparseable.
 */
function angleArgToDeg(arg: string): number | null {
  const p = parseNumberUnit(arg)
  if (!p) return null
  switch (p.unit.toLowerCase()) {
    case 'deg':
      return p.n
    case 'grad':
      return (p.n * 360) / 400
    case 'rad':
      return (p.n * 180) / Math.PI
    case 'turn':
      return p.n * 360
    default:
      return null
  }
}

/** Minimal box measurement needed to resolve %-unit translations. */
export type BoxDimsLike = Pick<RectLike, 'width' | 'height'>

/**
 * Length argument → px. px resolves directly; percentages resolve against
 * the caller-provided box dims when available (CSS semantics: translateX→
 * width, translateY→height; % on Z has no dimension semantics in the 2D
 * model and stays 0). Without dims, percentages contribute 0 instead of
 * poisoning the chain (parseTranslatePair's documented Phase-1 fallback).
 * Bare numbers are invalid CSS for lengths unless zero; other linear units
 * (em, rem, vw, …) are unresolvable without font/viewport context → 0.
 */
function lengthArgToPx(
  arg: string,
  axis: 'x' | 'y' | 'z',
  dims?: BoxDimsLike | null,
): number | null {
  const p = parseNumberUnit(arg)
  if (!p) return null
  if (p.unit === '') return p.n === 0 ? 0 : null
  const unit = p.unit.toLowerCase()
  if (unit === 'px') return p.n
  if (unit === '%' && dims) {
    if (axis === 'x') return (p.n / 100) * dims.width
    if (axis === 'y') return (p.n / 100) * dims.height
    return 0 // % on Z
  }
  return 0 // '%'-without-dims, em, rem, vw, …
}

/** Scale factors are unitless numbers, full stop. */
function scaleArgToNum(arg: string): number | null {
  const p = parseNumberUnit(arg)
  if (!p || p.unit !== '') return null
  return p.n
}

/**
 * Parse an interpolated composite `transform` track value into a GizmoPose.
 *
 * Known functions compose additively/multiplicatively regardless of order:
 *   - translateX/Y/Z, translate → px translations that SUM (Z validated
 *     then dropped — it projects away in 2D)
 *   - rotate → degrees that SUM (deg/grad/rad/turn)
 *   - scale/scaleX/scaleY → per-axis factors that MULTIPLY, collapsed to
 *     the uniform scale the pose model carries
 *
 * Out of scope BY CONTRACT (return null so callers fall back to identity):
 * skew/skewX/skewY, matrix/matrix3d, and every unrecognized function — a
 * 2D affine pose cannot represent them. Empty/'none'/junk → null too.
 *
 * When `dims` is provided, percent translations resolve against the box at
 * pose time (translateX→width, translateY→height). Without dims they
 * contribute 0 rather than nulling the chain (same Phase-1 limitation as
 * parseTranslatePair).
 *
 * Never throws; total over arbitrary strings.
 */
export function parseCompositeTransform(
  value: string,
  dims?: BoxDimsLike | null,
): GizmoPose | null {
  const v = value.trim()
  if (!v || v.toLowerCase() === 'none') return null

  let tx = 0
  let ty = 0
  let rotDeg = 0
  let sx = 1
  let sy = 1
  let cursor = 0 // end of the last matched fn(args) span
  let seen = 0 // matched functions so far

  COMPOSITE_FN_RE.lastIndex = 0
  for (let m = COMPOSITE_FN_RE.exec(v); m !== null; m = COMPOSITE_FN_RE.exec(v)) {
    // Text between recognized functions must be whitespace only — stray
    // tokens make the whole value untrustworthy.
    if (v.slice(cursor, m.index).trim() !== '') return null
    cursor = m.index + m[0].length
    seen++
    const fn = (m[1] ?? '').toLowerCase()
    const rawArgs = (m[2] ?? '').trim()
    const args = rawArgs === '' ? [] : rawArgs.split(',').map((a) => a.trim())
    const first = (): string => args[0] ?? ''

    switch (fn) {
      case 'translate': {
        if (args.length < 1 || args.length > 2) return null
        const x = lengthArgToPx(first(), 'x', dims)
        if (x === null) return null
        const y = args.length === 2 ? lengthArgToPx(args[1], 'y', dims) : 0
        if (y === null) return null
        tx += x
        ty += y
        break
      }
      case 'translatex': {
        if (args.length !== 1) return null
        const x = lengthArgToPx(first(), 'x', dims)
        if (x === null) return null
        tx += x
        break
      }
      case 'translatey': {
        if (args.length !== 1) return null
        const y = lengthArgToPx(first(), 'y', dims)
        if (y === null) return null
        ty += y
        break
      }
      case 'translatez': {
        // Z projects away in the gizmo's 2D model — validate, then drop.
        if (args.length !== 1) return null
        if (lengthArgToPx(first(), 'z', dims) === null) return null
        break
      }
      case 'rotate': {
        if (args.length !== 1) return null
        const d = angleArgToDeg(first())
        if (d === null) return null
        rotDeg += d
        break
      }
      case 'scale': {
        if (args.length < 1 || args.length > 2) return null
        const a = scaleArgToNum(first())
        if (a === null) return null
        const b = args.length === 2 ? scaleArgToNum(args[1]) : a
        if (b === null) return null
        sx *= a
        sy *= b
        break
      }
      case 'scalex': {
        if (args.length !== 1) return null
        const a = scaleArgToNum(first())
        if (a === null) return null
        sx *= a
        break
      }
      case 'scaley': {
        if (args.length !== 1) return null
        const a = scaleArgToNum(first())
        if (a === null) return null
        sy *= a
        break
      }
      default:
        // skew*/matrix/matrix3d/rotatex|y|z/perspective/unknown — out of
        // scope by contract: null makes callers fall back to identity.
        return null
    }
  }

  if (seen === 0) return null // no recognizable functions at all
  if (v.slice(cursor).trim() !== '') return null // trailing junk

  // Collapse accumulated per-axis scale into the pose's UNIFORM channel:
  // exact when the chain stayed isotropic (including mirrored negative
  // scales); otherwise an area-preserving best effort (geometric mean with
  // net reflection sign) — documented approximation; anisotropic gizmo
  // boxes are future work.
  const scale =
    Math.abs(sx - sy) <= 1e-9 * Math.max(1, Math.abs(sx), Math.abs(sy))
      ? sx
      : Math.sign(sx * sy) * Math.sqrt(Math.abs(sx * sy))
  return { tx, ty, rotDeg, scale }
}
