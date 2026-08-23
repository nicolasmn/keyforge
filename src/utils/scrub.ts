/**
 * Scrub interaction math — pure functions, unit-testable.
 *
 * Horizontal pointer movement maps to value deltas; Shift = ×10 coarse,
 * Alt = ÷10 fine. Per-unit sensitivity keeps px/ms/deg/% feeling similar.
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

export interface ScrubState {
  startX: number
  startValue: number
  unit: string
}

/** Value after dragging `dx` CSS pixels from the scrub origin. */
export function scrubbedValue(
  state: ScrubState,
  dx: number,
  modifiers: { shift?: boolean; alt?: boolean },
): number {
  const base = sensitivityFor(state.unit)
  // Shift = fine (effect ÷10), Alt = coarse (effect ×10)
  const effective = modifiers.shift ? base * 10 : modifiers.alt ? base / 10 : base
  return round3(state.startValue + dx / effective)
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
