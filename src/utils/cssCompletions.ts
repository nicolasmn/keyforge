/**
 * Curated CSS completion lists for inspector datalists.
 * Intentionally small — covers 95% of animation use-cases.
 */

export const CSS_NAMED_COLORS = [
  'transparent',
  'currentColor',
  'black',
  'white',
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'cyan',
  'magenta',
  'lime',
  'teal',
  'navy',
  'maroon',
  'olive',
  'silver',
  'gray',
  'grey',
  'coral',
  'salmon',
  'tomato',
  'gold',
  'khaki',
  'lavender',
  'violet',
  'indigo',
  'crimson',
  'turquoise',
  'aqua',
  'fuchsia',
]

export const CSS_EASING_COMPLETIONS = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier(0.4, 0, 0.2, 1)', // Material standard
  'cubic-bezier(0.4, 0, 1, 1)', // Material accelerate
  'cubic-bezier(0, 0, 0.2, 1)', // Material decelerate
  'cubic-bezier(0.34, 1.56, 0.64, 1)', // Spring overshoot
  'cubic-bezier(0.68, -0.55, 0.27, 1.55)', // Back in-out
  'cubic-bezier(0.23, 1, 0.32, 1)', // Ease out quint
  'cubic-bezier(0.55, 0, 1, 0.45)', // Ease in quint
  'steps(1)',
  'steps(2)',
  'steps(4)',
  'steps(8)',
  'steps(1, start)',
  'steps(1, end)',
]

export const CSS_TRANSFORM_COMPLETIONS = [
  'translateX(0px)',
  'translateY(0px)',
  'translateZ(0px)',
  'translate(0px, 0px)',
  'translate3d(0px, 0px, 0px)',
  'scaleX(1)',
  'scaleY(1)',
  'scale(1)',
  'scale(1, 1)',
  'scale3d(1, 1, 1)',
  'rotate(0deg)',
  'rotateX(0deg)',
  'rotateY(0deg)',
  'rotateZ(0deg)',
  'skewX(0deg)',
  'skewY(0deg)',
  'perspective(500px)',
  'matrix(1, 0, 0, 1, 0, 0)',
]

/** Length + percentage units (for width, height, border-radius, translate, etc.) */
export const LENGTH_UNITS = [
  'px',
  'rem',
  'em',
  '%',
  'vw',
  'vh',
  'vmin',
  'vmax',
  'dvw',
  'dvh',
  'cm',
  'mm',
  'in',
  'pt',
  'pc',
  'ch',
  'ex',
  'fr',
] as const

/** Angle units */
export const ANGLE_UNITS = ['deg', 'rad', 'turn', 'grad'] as const

/** Time units */
export const TIME_UNITS = ['ms', 's'] as const

/** Unitless (opacity, scale, etc.) */
export const UNITLESS: readonly string[] = [''] as const

/** All number units in display order */
export const CSS_NUMBER_UNITS: readonly string[] = [
  ...LENGTH_UNITS,
  ...ANGLE_UNITS,
  ...TIME_UNITS,
  '',
]

/** Unit groups for the unit selector dropdown */
export const UNIT_GROUPS: { label: string; units: readonly string[] }[] = [
  { label: 'Length', units: LENGTH_UNITS },
  { label: 'Angle', units: ANGLE_UNITS },
  { label: 'Time', units: TIME_UNITS },
  { label: 'Unitless', units: UNITLESS },
]

/** Returns true when the unit is an angle unit */
export function isAngleUnit(unit: string): boolean {
  return (ANGLE_UNITS as readonly string[]).includes(unit)
}

/** Convert an angle value+unit to degrees (for visual preview) */
export function toDeg(value: number, unit: string): number {
  switch (unit) {
    case 'deg':
      return value
    case 'rad':
      return value * (180 / Math.PI)
    case 'turn':
      return value * 360
    case 'grad':
      return value * 0.9
    default:
      return value
  }
}

/**
 * Inverse of toDeg — express a degree measure in the given angle unit.
 * Used by the rotation dial to commit drags/nudges back in the authored unit
 * instead of silently rewriting values to deg.
 */
export function fromDeg(deg: number, unit: string): number {
  switch (unit) {
    case 'deg':
      return deg
    case 'rad':
      return deg * (Math.PI / 180)
    case 'turn':
      return deg / 360
    case 'grad':
      return deg / 0.9
    default:
      return deg
  }
}

// ── Angle formatting (DevTools conventions) ───────────────────────────────────
//
// Chrome DevTools' roundAngleByUnit (CSSAngleUtils.ts) writes committed angle
// strings at a per-unit precision: integers for deg/grad, ≤2dp for turn,
// ≤4dp for rad. The old uniform `.toFixed(2)`-in-the-authored-unit produced
// exactly the fractional noise this replaces ("0.02"-style collapse runs in
// turn, lossy rad values).

/** Decimal places after the point, per authored angle unit (DevTools baseline). */
export const ANGLE_UNIT_PRECISION: Readonly<Record<string, number>> = {
  deg: 0,
  grad: 0,
  turn: 2,
  rad: 4,
}

/**
 * Round-trip tolerance in degrees: whatever formatAngle emits must convert
 * back to within this error of the dial's integer-degree value, or the needle
 * visibly jumps away from the gesture on the next render. (DevTools' own 2dp
 * turn quantum is 3.6° — max error 1.8° — so we widen precision just past its
 * baseline when needed; see formatAngle.)
 */
const ROUND_TRIP_TOLERANCE_DEG = 0.5

/** Hard cap on emitted decimals (rad's precision — never emit more than this). */
const MAX_ANGLE_PRECISION = 4

function wrapDeg360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * Snap an angle to the nearest multiple of `step` degrees, wrapped to
 * [0, 360). Used by Shift+drag on the rotation dial (DevTools' coarse
 * modifier: multiples of 15°). With no/invalid step, passes through unchanged.
 */
export function snapToMultiple(deg: number, step?: number): number {
  if (!step || step <= 0) return deg
  const snapped = Math.round(deg / step) * step
  return ((snapped % 360) + 360) % 360
}

/**
 * Express an angle in the authored unit as a clean CSS number string,
 * following DevTools per-unit precision (ANGLE_UNIT_PRECISION) with
 * trailing zeros trimmed and no float noise (`0.3`, never
 * `0.30000000000000004`, no scientific notation).
 *
 * Precision widens past the baseline only when the baseline would not round-
 * trip within ROUND_TRIP_TOLERANCE_DEG of the input (e.g. 45° cannot be a
 * clean 2dp turn — `0.13` is 46.8° — so it becomes `0.125`). Inputs are
 * wrapped to [0, 360): 360 ≡ 0, −90 ≡ 270.
 */
export function formatAngle(deg: number, unit: string): string {
  const d = wrapDeg360(deg)
  const base = ANGLE_UNIT_PRECISION[unit] ?? 2
  let out = trimZeros(fromDeg(d, unit).toFixed(base))
  // Bump decimals until the committed string reads back as the same angle.
  for (
    let p = base;
    p < MAX_ANGLE_PRECISION &&
    Math.abs(toDeg(parseFloat(out), unit) - d) > ROUND_TRIP_TOLERANCE_DEG;
    p++
  ) {
    out = trimZeros(fromDeg(d, unit).toFixed(p + 1))
  }
  return out === '-0' ? '0' : out
}

/** Build a sorted, unique completion list for a given token type + current value */
export function completionsFor(type: string, current: string): string[] {
  switch (type) {
    case 'color':
      return CSS_NAMED_COLORS
    case 'easing':
      return CSS_EASING_COMPLETIONS
    case 'transform':
      return CSS_TRANSFORM_COMPLETIONS
    case 'number': {
      const num = current.replace(/[^\d.-]/g, '') || '0'
      return CSS_NUMBER_UNITS.filter(Boolean).map((u) => `${num}${u}`)
    }
    default:
      return []
  }
}
