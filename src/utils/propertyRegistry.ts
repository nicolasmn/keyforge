import type { AnimatableProperty } from '@/types'

/**
 * Central registry of per-property animation metadata.
 *
 * Single source of truth for: valid units, value validation, defaults,
 * and interpolation semantics. Consumed by the Inspector (unit filtering,
 * validation), smart keyframe defaults, and future scrubbing features.
 */

export interface PropertyMeta {
  /** Units a number value may carry for this property. */
  units: readonly string[]
  /** Range constraint for numeric values (null = unbounded). */
  min?: number
  max?: number
  /** Sensible starting value when the first keyframe is created. */
  defaultValue: string
  /**
   * 'interpolable' — numbers/colors interpolate smoothly.
   * 'discrete' — flips at 50% (e.g. visibility); editors should warn.
   */
  kind: 'interpolable' | 'discrete'
  /** Human hint shown on invalid input. */
  hint: string
}

const LENGTH_UNITS = ['px', '%', 'em', 'rem', 'vw', 'vh'] as const

export const PROPERTY_REGISTRY: Record<AnimatableProperty, PropertyMeta> = {
  opacity: {
    units: [''],
    min: 0,
    max: 1,
    defaultValue: '0',
    kind: 'interpolable',
    hint: 'opacity expects a bare number 0–1 (no units)',
  },
  transform: {
    units: ['px', 'deg', '%', 'turn', 'rad'],
    defaultValue: 'translateY(40px)',
    kind: 'interpolable',
    hint: 'transform takes function values like translateY(40px)',
  },
  'background-color': {
    units: [],
    defaultValue: 'hsl(264 80% 68%)',
    kind: 'interpolable',
    hint: 'background-color takes color values',
  },
  color: {
    units: [],
    defaultValue: 'hsl(220 10% 88%)',
    kind: 'interpolable',
    hint: 'color takes color values',
  },
  'border-radius': {
    units: LENGTH_UNITS,
    defaultValue: '0px',
    kind: 'interpolable',
    hint: 'border-radius takes lengths (px, %, em…)',
  },
  width: {
    units: LENGTH_UNITS,
    min: 0,
    defaultValue: '80px',
    kind: 'interpolable',
    hint: 'width takes lengths (px, %, em…)',
  },
  height: {
    units: LENGTH_UNITS,
    min: 0,
    defaultValue: '80px',
    kind: 'interpolable',
    hint: 'height takes lengths (px, %, em…)',
  },
  scale: {
    units: [''],
    defaultValue: '1',
    kind: 'interpolable',
    hint: 'scale expects a bare number (1 = 100%)',
  },
  translate: {
    units: LENGTH_UNITS,
    defaultValue: 'translate(0px, 0px)',
    kind: 'interpolable',
    hint: 'translate takes length pairs like translate(10px, 20px)',
  },
  rotate: {
    units: ['deg', 'rad', 'turn'],
    defaultValue: 'rotate(0deg)',
    kind: 'interpolable',
    hint: 'rotate takes angles (deg, rad, turn)',
  },
}

/** Validate a plain number+unit value against the property's registry entry. */
export function isValidNumberForProperty(
  property: AnimatableProperty,
  numStr: string,
  unit: string,
): boolean {
  const meta = PROPERTY_REGISTRY[property]
  if (!meta) return true // unknown property → don't block
  if (!meta.units.includes(unit)) return false
  const n = Number.parseFloat(numStr)
  if (Number.isNaN(n)) return false
  if (meta.min !== undefined && n < meta.min) return false
  if (meta.max !== undefined && n > meta.max) return false
  return true
}
