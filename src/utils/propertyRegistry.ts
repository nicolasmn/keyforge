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
    defaultValue: '0deg',
    kind: 'interpolable',
    hint: 'rotate takes a bare angle like 90deg — not rotate(90deg)',
  },
}

const ANGLE_VALUE_RE = /^-?\d*\.?\d+(deg|grad|rad|turn)$/i
const LENGTH_VALUE_RE = /^-?\d*\.?\d+(px|%|em|rem|vw|vh|cm|mm|q|in|pc|pt|ex|ch)$/i
const PLAIN_NUMBER_RE = /^-?\d*\.?\d+$/

interface ParsedFn {
  fn: string
  args: string[]
}

function parseFunctionValue(value: string): ParsedFn | null {
  const m = /^([a-zA-Z][a-zA-Z0-9]*)\(([^()]*)\)$/.exec(value.trim())
  if (!m) return null
  return { fn: m[1].toLowerCase(), args: m[2].split(',').map((s) => s.trim()) }
}

/**
 * Convert a stored track value into valid syntax for its CSS property.
 *
 * Keyforge historically stored spatial-track values in transform-FUNCTION
 * syntax (`rotate(360deg)`). That is invalid for the individual CSS
 * transform properties (`rotate:` accepts a bare `<angle>`, optionally
 * preceded by an axis) — browsers drop such declarations while parsing
 * @keyframes, silently disabling the whole animation (computed `rotate`
 * stays `none`). See css-transforms-2 §5.
 *
 * This normalizes known function forms to individual-property syntax at
 * CSS-emission time (preview + export) and at CSS-import time; values that
 * are already valid pass through untouched, and unrecognized shapes are
 * returned as-is rather than guessed at (e.g. calc()).
 */
export function toCssPropertyValue(property: AnimatableProperty | string, value: string): string {
  const v = value.trim()
  const parsed = parseFunctionValue(v)
  if (!parsed) return v
  const { fn, args } = parsed

  if (property === 'rotate') {
    // Individual `rotate`: `[x|y|z|<number>{3}] && <angle>`
    const [a] = args
    if (a === undefined || !ANGLE_VALUE_RE.test(a)) return v
    if (fn === 'rotate' || fn === 'rotatez') return a
    if (fn === 'rotatex') return `x ${a}`
    if (fn === 'rotatey') return `y ${a}`
    return v
  }

  if (property === 'translate') {
    // Individual `translate`: `<length-percentage> <length-percentage>? <length>?`
    if (args.length === 0 || !args.every((s) => LENGTH_VALUE_RE.test(s))) return v
    if (fn === 'translate' || fn === 'translate3d') return args.join(' ')
    if (fn === 'translatex') return `${args[0]}`
    if (fn === 'translatey') return `0px ${args[0]}`
    if (fn === 'translatez') return `0px 0px ${args[0]}`
    return v
  }

  if (property === 'scale') {
    // Individual `scale`: `<number> <number>? <number>?` (identity = 1)
    if (args.length === 0 || !args.every((s) => PLAIN_NUMBER_RE.test(s))) return v
    if (fn === 'scale' || fn === 'scale3d') return args.join(' ')
    if (fn === 'scalex') return args[0]
    if (fn === 'scaley') return `1 ${args[0]}`
    if (fn === 'scalez') return `1 1 ${args[0]}`
    return v
  }

  return v
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
