/**
 * Spatial-track composition — pure functions.
 *
 * CSS can express a layer's motion through BOTH transform-function tracks
 * (`transform: translateY(40px)`) and individual-property tracks
 * (`rotate: 45deg`). They are not equivalent:
 *
 * 1. Two animations that animate the SAME property cannot compose. Per
 *    css-animations-1, "if at some point in time there are multiple
 *    animations specifying behavior for the same property, the animation
 *    which occurs last in the value of animation-name will override the
 *    other animations" — so two `transform`-type tracks on one layer render
 *    as "last one wins". The fix is to merge them into ONE composed
 *    transform channel at generation time (concatenated function stacks,
 *    sampled at every keyframe time so each source track keeps its own
 *    times/easings).
 *
 * 2. A `transform` animation DOES compose with animated individual
 *    properties (translate/rotate/scale apply before transform per
 *    css-transforms-2) because they are different properties — no merging
 *    needed there. But those properties take bare values (`rotate: 45deg`,
 *    `translate: 10px 20px`, `scale: 1.5`), NOT function values; legacy
 *    docs authored against old defaults carry `rotate(45deg)`-style values
 *    which browsers drop as invalid. toIndividualPropertyValue() rewrites
 *    them at emission time.
 */

import type { AnimatableProperty, Keyframe, Track } from '@/types'
import { applyEasing } from './interpolate'
import { parseTransformStack } from './transformStack'

const NUM_UNIT_RE = /^(-?[\d.]+)([a-z%]*)$/

/** Max distance (ms) between sampled stops when baking non-linear easing. */
export const MERGE_SAMPLE_STEP_MS = 50

function parseNum(s: string): { n: number; unit: string } | null {
  const m = NUM_UNIT_RE.exec(s.trim())
  if (!m) return null
  const n = Number.parseFloat(m[1])
  if (Number.isNaN(n)) return null
  return { n, unit: m[2] }
}

function round(n: number): string {
  const r = Number(n.toFixed(4))
  return String(r)
}

/**
 * Interpolate two transform-function stacks element-wise. Returns null when
 * the stacks don't align (different functions/order/arg counts) or any arg
 * pair isn't numeric-with-unit — callers then hold the previous value,
 * matching the stepped fallback used elsewhere.
 */
function lerpStacks(a: string, b: string, t: number): string | null {
  const sa = parseTransformStack(a)
  const sb = parseTransformStack(b)
  if (sa.length === 0 || sa.length !== sb.length) return null

  const out: string[] = []
  for (let i = 0; i < sa.length; i++) {
    if (sa[i].name !== sb[i].name) return null
    const argPairs = sa[i].args.split(',').map((s) => s.trim())
    const argsB = sb[i].args.split(',').map((s) => s.trim())
    if (argPairs.length !== argsB.length) return null
    const lerpedArgs = argPairs.map((argA, j) => {
      const na = parseNum(argA)
      const nb = parseNum(argsB[j])
      if (!na || !nb || na.unit !== nb.unit) return null
      return `${round(na.n + (nb.n - na.n) * t)}${na.unit}`
    })
    if (lerpedArgs.some((x) => x === null)) return null
    out.push(`${sa[i].name}(${lerpedArgs.join(', ')})`)
  }
  return out.join(' ')
}

/** Interpolate two plain number+unit values ('40px' → '100px'); else null. */
function lerpNumericValues(a: string, b: string, t: number): string | null {
  const na = parseNum(a)
  const nb = parseNum(b)
  if (!na || !nb || na.unit !== nb.unit) return null
  return `${round(na.n + (nb.n - na.n) * t)}${na.unit}`
}

/**
 * Value `track` renders at `time`, with its own keyframe times AND easings:
 * numeric pairs lerp through the leaving keyframe's easing curve; aligned
 * transform stacks interpolate per-function; anything else steps/holds.
 */
export function sampleTrackValue(track: Track, time: number): string {
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time)
  if (sorted.length === 0) return ''
  if (time <= sorted[0].time) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (time >= last.time) return last.value

  let prev = sorted[0]
  let next = last
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].time >= time) {
      next = sorted[i]
      break
    }
    prev = sorted[i]
  }
  if (next.time === time) return next.value

  const span = next.time - prev.time
  const raw = span <= 0 ? 0 : (time - prev.time) / span
  const eased = applyEasing(raw, prev.easing)

  if (track.property === 'transform') {
    return lerpStacks(prev.value, next.value, eased) ?? prev.value
  }
  return lerpNumericValues(prev.value, next.value, eased) ?? prev.value
}

/** Easing of the keyframe governing the segment leaving time `u`. */
function leavingEasing(track: Track, u: number): string {
  let easing = 'linear'
  for (const kf of track.keyframes) {
    if (kf.time <= u) easing = kf.easing
    else break
  }
  return easing
}

const clampTime = (t: number, duration: number) => Math.max(0, Math.min(duration, t))

/**
 * Merge multiple `transform`-type tracks into ONE virtual composed track:
 * stops at every source keyframe time (so real keys stay exact), subdivided
 * wherever a non-linear easing is in effect (easing shapes are baked into
 * the sampled values, so emitted stops interpolate linearly). Function
 * stacks concatenate in track order.
 */
export function mergeTransformTracks(group: Track[], duration: number): Track {
  const base = group[0]
  const unionTimes = [
    ...new Set(group.flatMap((t) => t.keyframes.map((k) => clampTime(k.time, duration)))),
  ].sort((a, b) => a - b)

  const stops: number[] = []
  for (let i = 0; i < unionTimes.length; i++) {
    const u = unionTimes[i]
    stops.push(u)
    const nextU = unionTimes[i + 1]
    if (nextU === undefined) break
    const curved = group.some((t) => leavingEasing(t, u) !== 'linear')
    if (curved) {
      for (let s = u + MERGE_SAMPLE_STEP_MS; s < nextU; s += MERGE_SAMPLE_STEP_MS) {
        stops.push(s)
      }
    }
  }

  const keyframes: Keyframe[] = stops.map((time, i) => ({
    id: `${base.id}-m${i}`,
    time,
    value: group
      .map((t) => sampleTrackValue(t, time))
      .filter(Boolean)
      .join(' '),
    easing: 'linear',
  }))

  return { id: base.id, property: 'transform', keyframes }
}

/**
 * Effective track list for CSS generation: duplicate `transform`-type
 * tracks collapse into one merged channel at the position of the first;
 * everything else passes through untouched.
 */
export function composeSpatialTracks(tracks: Track[], duration: number): Track[] {
  const groups = new Map<AnimatableProperty, Track[]>()
  for (const t of tracks) {
    const g = groups.get(t.property) ?? []
    g.push(t)
    groups.set(t.property, g)
  }

  const out: Track[] = []
  for (const [property, group] of groups) {
    if (property === 'transform' && group.length > 1)
      out.push(mergeTransformTracks(group, duration))
    else out.push(...group)
  }
  return out
}

// ── Individual-property value sanitation ────────────────────────────────

const LEN_RE = /^-?[\d.]+(px|%|em|rem|vw|vh)$/
const ANGLE_RE = /^-?[\d.]+(deg|rad|turn|grad)$/
const NUM_RE = /^-?[\d.]+$/

/**
 * Rewrite legacy transform-function-style values to the syntax the
 * individual `rotate` / `translate` / `scale` properties actually accept.
 * Unrecognized values pass through unchanged (browsers will ignore invalid
 * declarations either way).
 */
export function toIndividualPropertyValue(property: AnimatableProperty, value: string): string {
  const v = value.trim()
  if (property === 'rotate') {
    // rotate: rotate(90deg) → rotate: 90deg
    const m = /^rotate\(\s*([^)]*)\)$/.exec(v)
    if (m && ANGLE_RE.test(m[1].trim())) return m[1].trim()
    return v
  }
  if (property === 'translate') {
    // translate: translate(10px, 20px) → translate: 10px 20px
    const m = /^(?:translate3d|translate)\(\s*([^)]*)\)$/.exec(v)
    if (m) {
      const parts = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts.length >= 1 && parts.length <= 3 && parts.every((p) => LEN_RE.test(p))) {
        return parts.join(' ')
      }
      return v
    }
    // translateX/Y(a) → single/two-component form (Y defaults to 0px)
    const mx = /^translateX\(\s*([^)]*)\)$/.exec(v)
    if (mx && LEN_RE.test(mx[1].trim())) return mx[1].trim()
    const my = /^translateY\(\s*([^)]*)\)$/.exec(v)
    if (my && LEN_RE.test(my[1].trim())) return `0px ${my[1].trim()}`
    return v
  }
  if (property === 'scale') {
    // scale: scale(1.5, 2) → scale: 1.5 2 ; scale(2) → scale: 2
    const m = /^scale\(\s*([^)]*)\)$/.exec(v)
    if (m) {
      const parts = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts.length >= 1 && parts.length <= 3 && parts.every((p) => NUM_RE.test(p))) {
        return parts.join(' ')
      }
    }
    return v
  }
  return v
}
