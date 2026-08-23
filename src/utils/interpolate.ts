import type { Track, Keyframe } from '@/types'
import { parseCubicBezier, evalCubicBezier, BUILTIN_PRESETS } from './easing-presets'

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

/** Linear-eased numeric interpolation between two keyframes. */
function lerpNumeric(a: Keyframe, b: Keyframe, time: number): string | null {
  const ma = NUM_UNIT_RE.exec(a.value)
  const mb = NUM_UNIT_RE.exec(b.value)
  if (!ma || !mb) return null
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

export function applyEasing(t: number, easing: string): number {
  if (easing === 'linear') return t
  // linear() curves (springs) would need their own sampler; approximating
  // as linear keeps pose-capture usable until a dedicated evaluator lands.
  if (easing.startsWith('linear(')) return t
  // Named presets ('ease-in', 'ease-out-back', …) resolve to their
  // canonical cubic-bezier before evaluation.
  const named = BUILTIN_PRESETS.find((p) => p.name === easing)
  const bez = parseCubicBezier(named ? named.value : easing)
  if (!bez) return t
  return evalCubicBezier(t, bez)
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
  return lerpNumeric(prev, next, time) ?? prev.value
}
