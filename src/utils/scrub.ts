/**
 * Scrub interaction math — pure functions, unit-testable.
 *
 * Horizontal pointer movement maps to value deltas; per-unit sensitivity
 * keeps px/ms/deg/% feeling similar.
 *
 * UNIFIED MODIFIER LADDER (app-wide, applies to chip dragging AND arrow-key
 * nudging AND the rotation dial):
 *   default → 1-unit steps (whole numbers)
 *   Alt     → ÷10 fine steps (0.1)
 *   Shift   → ×10 coarse steps
 *
 * History: this module previously inverted the ladder (Shift = fine ÷10,
 * Alt = coarse ×10) while every other surface — arrow nudges, dial Shift
 * snapping, dial keyboard — used Shift = coarse. Unified on Shift = COARSE.
 *
 * Fractional-scale properties (`opacity`, standalone `scale`) keep a 0.05
 * base step so their native [0..1]-ish range stays reachable at the default
 * modifier; the ladder still scales it (Alt 0.005 / Shift 0.5).
 */

const UNIT_SENSITIVITY: Record<string, number> = {
  // pixels of drag per 1.0 unit change
  '': 150, // bare numbers (opacity, scale)
  px: 3,
  '%': 2,
  em: 60,
  rem: 60,
  vw: 4,
  vh: 4,
  deg: 2,
  rad: 120,
  turn: 300,
  s: 800,
  ms: 0.8,
}

export function sensitivityFor(unit: string): number {
  return UNIT_SENSITIVITY[unit] ?? 5
}

export interface ScrubModifiers {
  shift?: boolean
  alt?: boolean
}

/** Fractional-scale properties whose usable increments are < 1 whole unit. */
const FRACTIONAL_STEP_PROPERTIES = new Set(['opacity', 'scale'])

/**
 * Base quantization step (in the value's own unit) BEFORE modifier scaling:
 * 1 whole unit everywhere except fractional-scale properties (opacity,
 * scale), which step by 0.05 to stay usable inside their [0, 1] range.
 */
export function baseStepFor(property?: string): number {
  return property !== undefined && FRACTIONAL_STEP_PROPERTIES.has(property) ? 0.05 : 1
}

/**
 * Effective step for the active modifiers: Alt = ÷10 (fine), Shift = ×10
 * (coarse). Both held → Alt wins (fine beats coarse, matches DevTools).
 */
export function stepWithModifiers(baseStep: number, modifiers: ScrubModifiers): number {
  if (modifiers.alt) return baseStep / 10
  if (modifiers.shift) return baseStep * 10
  return baseStep
}

export interface ScrubState {
  /** Kept for API compatibility with earlier call sites; `dx` is authoritative. */
  startX: number
  startValue: number
  unit: string
  /** Owning property context → picks the base step via baseStepFor(). */
  property?: string
  /** Explicit base-step override; wins over the property/unit lookup when set. */
  baseStep?: number
}

/**
 * Quantized value after dragging `dx` CSS pixels from the scrub origin.
 *
 * Snapping is delta-relative (anchored at startValue): an off-grid starting
 * value never jumps on grab — it only moves once the drag crosses half a
 * step. Results are rounded to 3dp to strip binary-float noise from ÷10
 * fine steps.
 */
export function scrubbedValue(state: ScrubState, dx: number, modifiers: ScrubModifiers): number {
  const sensitivity = sensitivityFor(state.unit)
  const base = state.baseStep ?? baseStepFor(state.property)
  const step = stepWithModifiers(base, modifiers)
  const raw = state.startValue + dx / sensitivity
  const snapped = state.startValue + Math.round((raw - state.startValue) / step) * step
  return round3(snapped)
}

function round3(n: number): number {
  return Number(n.toFixed(3))
}

/** Clamp a scrubbed value to the property's registry range when known. */
export function clampToProperty(property: string | undefined, value: number): number {
  if (!property) return value
  // avoid circular import: inline the two ranged entries
  if (property === 'opacity') return Math.max(0, Math.min(1, value))
  if (property === 'width' || property === 'height') return Math.max(0, value)
  return value
}
