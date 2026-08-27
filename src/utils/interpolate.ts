import type { Track, Keyframe } from '@/types'
import { parseCubicBezier, evalCubicBezier, BUILTIN_PRESETS } from './easing-presets'
import { lerpStacks } from './spatialCompose'
import { parseLinearEasing } from './spring'

/**
 * Interpolated value of a track at an arbitrary time — what the preview
 * *shows* at that moment. Numeric+unit values lerp linearly between the
 * surrounding keyframes with the leaving keyframe's easing applied;
 * non-numeric values (colors, transforms, keywords) step/hold.
 *
 * This exists so "+ KF at playhead" can capture the pose the user sees,
 * making pose-to-pose workflow natural.
 */

const NUM_UNIT_RE = /^(-?[\d.]+)([a-z%]*)$/

/** Parse a single numeric+unit component, e.g. "10px" → [10, "px"]. */
function parseComponent(s: string): [number, string] | null {
  const m = NUM_UNIT_RE.exec(s)
  if (!m) return null
  const n = Number.parseFloat(m[1])
  if (Number.isNaN(n)) return null
  return [n, m[2]]
}

/**
 * Linear-eased numeric interpolation between two keyframes.
 *
 * Handles both single-component values ("0.5", "100px") and
 * space-separated multi-component values ("10px 20px", "1.5 2").
 * Each component lerps independently with the same eased `t`,
 * matching CSS interpolation semantics.
 */
function lerpNumeric(a: Keyframe, b: Keyframe, time: number): string | null {
  // Fast path: single-component (the common case: opacity, rotate, single scale)
  const ma = NUM_UNIT_RE.exec(a.value)
  const mb = NUM_UNIT_RE.exec(b.value)
  if (ma && mb) {
    const na = Number.parseFloat(ma[1])
    const nb = Number.parseFloat(mb[1])
    if (Number.isNaN(na) || Number.isNaN(nb)) return null
    // unit must match for a meaningful lerp ('10px' -> '50%' has no linear answer)
    if (ma[2] !== mb[2]) return null

    const span = b.time - a.time
    let t = span === 0 ? 0 : (time - a.time) / span
    t = Math.max(0, Math.min(1, t))

    const eased = applyEasing(t, a.easing)
    const n = na + (nb - na) * eased
    // Round to a clean value first, then trim trailing zeros so '25.0px'
    // renders as '25px' and '0.25' keeps its precision ('1' → '1', not '1.000').
    const rounded = Number(n.toFixed(3))
    return `${rounded}${ma[2]}`
  }

  // Multi-component path: split on whitespace (normalize commas → spaces
  // so function-form values like "translate(0px, 0px)" are handled too).
  const aParts = a.value.replace(/,/g, ' ').trim().split(/\s+/)
  const bParts = b.value.replace(/,/g, ' ').trim().split(/\s+/)
  if (aParts.length !== bParts.length || aParts.length < 2) return null

  const aComps = aParts.map(parseComponent)
  const bComps = bParts.map(parseComponent)
  if (aComps.some((c) => c === null) || bComps.some((c) => c === null)) return null
  // Each component pair must have matching units
  for (let i = 0; i < aComps.length; i++) {
    if (aComps[i]![1] !== bComps[i]![1]) return null
  }

  const span = b.time - a.time
  let t = span === 0 ? 0 : (time - a.time) / span
  t = Math.max(0, Math.min(1, t))

  // Easing is computed ONCE and applied to ALL components identically.
  const eased = applyEasing(t, a.easing)

  const result = aComps.map((ac, i) => {
    const bc = bComps[i]!
    const na = ac![0]
    const n = na + (bc[0] - na) * eased
    const rounded = Number(n.toFixed(3))
    return `${rounded}${ac![1]}`
  })
  return result.join(' ')
}

export function applyEasing(t: number, easing: string): number {
  if (easing === 'linear') return t
  // linear() curves (springs): sample the piecewise-linear easing function.
  if (easing.startsWith('linear(')) {
    const m = easing.match(/linear\s*\(([^)]*)\)/i)
    if (!m) return t
    const stops = parseLinearEasing(m[1])
    if (!stops || stops.length < 2) return t
    return evalLinearEasing(t, stops)
  }
  // Named presets ('ease-in', 'ease-out-back', …) resolve to their
  // canonical cubic-bezier before evaluation.
  const named = BUILTIN_PRESETS.find((p) => p.name === easing)
  const bez = parseCubicBezier(named ? named.value : easing)
  if (!bez) return t
  return evalCubicBezier(t, bez)
}

/**
 * Evaluate a `linear()` easing function at progress `t` (0..1).
 * Stops are { position, progress } pairs — position is the output value
 * (y-axis), progress is the input time (x-axis, 0..1).
 * Finds the bracketing pair and lerps.
 */
function evalLinearEasing(t: number, stops: { position: number; progress: number }[]): number {
  // Clamp t to stop range
  if (t <= stops[0].progress) return stops[0].position
  const last = stops[stops.length - 1]
  if (t >= last.progress) return last.position

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t >= a.progress && t <= b.progress) {
      const span = b.progress - a.progress
      if (span <= 0) return a.position
      const localT = (t - a.progress) / span
      return a.position + (b.position - a.position) * localT
    }
  }
  return last.position
}

/**
 * Value the preview shows for `track` at `time`.
 * Falls back to hold semantics (same as buildKeyframeBlock) when a value
 * pair can't be interpolated numerically.
 */
export function interpolatedValueAt(track: Track, time: number): string | null {
  if (track.keyframes.length === 0) return null
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time)

  const nextIdx = sorted.findIndex((k) => k.time >= time)
  if (nextIdx === -1) return sorted[sorted.length - 1].value // past last → hold last
  const next = sorted[nextIdx]
  if (next.time === time) return next.value // exact hit
  if (nextIdx === 0) return sorted[0].value // before first → hold first

  const prev = sorted[nextIdx - 1]

  // Transform tracks store CSS function stacks like "translateY(40px)" or
  // "translate(10px, 20px) rotate(45deg)" — lerpNumeric can't parse these.
  // Use lerpStacks which handles per-function interpolation.
  if (track.property === 'transform') {
    const span = next.time - prev.time
    const raw = span <= 0 ? 0 : (time - prev.time) / span
    const t = Math.max(0, Math.min(1, raw))
    const eased = applyEasing(t, prev.easing)
    return lerpStacks(prev.value, next.value, eased) ?? prev.value
  }

  return lerpNumeric(prev, next, time) ?? prev.value
}
