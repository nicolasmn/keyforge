import type { Layer, AnimationDocument, Track } from '@/types'

/**
 * Shared keyframe building logic used by css.ts (preview) and export.ts (export).
 *
 * For each unique time offset across all tracks, resolves the value for every
 * track using the last keyframe at-or-before that time (stepped/hold interpolation).
 *
 * Per-track timelines: within one @keyframes rule ALL properties share one
 * percentage timeline. A shared rule therefore injects false "hold" stops
 * into sibling tracks at times where they have no keyframe, breaking smooth
 * interpolation — so preview/export CSS emits one @keyframes rule per track
 * (buildSplitKeyframeBlocks), each referenced on the element's
 * animation-name list.
 */

export interface KeyframeBlocks {
  times: number[]
  /** name → @keyframes body; single empty-string name = legacy single block */
  blocks: Array<{ nameSuffix: string; properties: string[]; body: string }>
}

function trackValueAt(
  track: Track,
  time: number,
): { value: string; easing?: string; exact: boolean } | null {
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time)
  if (sorted.length === 0) return null
  const exact = sorted.find((k) => k.time === time)
  if (exact) {
    return { value: exact.value, easing: exact.easing, exact: true }
  }
  const kf = [...sorted].reverse().find((k) => k.time <= time)
  const active = kf ?? sorted[0]
  return { value: active.value, exact: false }
}

function stopBody(layer: Layer, time: number): string {
  const props = layer.tracks
    .map((track) => {
      const r = trackValueAt(track, time)
      if (!r) return ''
      const timing =
        r.exact && r.easing && r.easing !== 'linear'
          ? ` animation-timing-function:${r.easing};`
          : ''
      return `${track.property}:${r.value};${timing}`
    })
    .filter(Boolean)
    .join(' ')
  return props
}

export function buildKeyframeBlock(
  layer: Layer,
  duration: AnimationDocument['duration'],
): { times: number[]; keyframeBlock: string } {
  const rawTimes = layer.tracks.flatMap((t) => t.keyframes.map((k) => k.time))
  const times = [...new Set([0, ...rawTimes, duration])].sort((a, b) => a - b)

  const keyframeBlock = times
    .map((time) => {
      const pct = ((time / duration) * 100).toFixed(2)
      const props = stopBody(layer, time)
      if (!props) return ''
      return `  ${pct}% { ${props} }`
    })
    .filter(Boolean)
    .join('\n')

  return { times, keyframeBlock }
}

/**
 * Detect whether any co-timed stop carries conflicting easings across
 * tracks (i.e. the shared-stop CSS semantics would corrupt one of them).
 */
export function hasCoTimedEasingConflict(layer: Layer): boolean {
  const byTime = new Map<number, Map<string, string>>()
  for (const track of layer.tracks) {
    for (const kf of track.keyframes) {
      const easings = byTime.get(kf.time) ?? new Map<string, string>()
      const easing = kf.easing || 'linear'
      // linear is neutral: a shared stop with mixed linear/X is NOT a
      // conflict because X's timing-function governs the segment leaving
      // this stop for every property anyway... but only when each
      // property's authored intent matches. Conservative: flag only
      // differing NON-linear easings.
      if (easing !== 'linear') easings.set(track.property, easing)
      byTime.set(kf.time, easings)
    }
  }
  for (const easings of byTime.values()) {
    const distinct = new Set(easings.values())
    if (distinct.size > 1) return true
  }
  return false
}

/**
 * Build one @keyframes block PER TRACK (always-split mode).
 *
 * Within a single @keyframes rule every property shares one percentage
 * timeline, so a shared rule would force false "hold" stops onto sibling
 * tracks at times where they have no keyframe of their own (breaking
 * interpolation between their real keys). Emitting one rule per track keeps
 * each property's timeline pure: stops appear ONLY at that track's own
 * keyframe times, plus boundary holds at 0%/100% (duplicating the nearest
 * value) when the track doesn't start/end at the document edges — CSS
 * requires both endpoints.
 *
 * Each rule is named `<baseName>-<trackIndex>` and referenced together on
 * the element's animation-name list.
 */
export function buildSplitKeyframeBlocks(
  layer: Layer,
  duration: AnimationDocument['duration'],
  baseName: string,
): { times: number[]; blocks: Array<{ name: string; css: string }> } {
  const rawTimes = layer.tracks.flatMap((t) => t.keyframes.map((k) => k.time))
  const times = [...new Set([0, ...rawTimes, duration])].sort((a, b) => a - b)

  const blocks = layer.tracks
    .filter((track) => track.keyframes.length > 0)
    .map((track, i) => {
      // Only this track's own keyframe times, clamped to the duration.
      const own = [...new Set(track.keyframes.map((k) => k.time))]
        .filter((t) => t >= 0 && t <= duration)
        .sort((a, b) => a - b)
      const ruleTimes = [...own]
      // Boundary holds: duplicate the nearest value so CSS sees both ends.
      if (!ruleTimes.includes(0)) ruleTimes.unshift(0)
      if (!ruleTimes.includes(duration)) ruleTimes.push(duration)

      const body = ruleTimes
        .map((time) => {
          const pct = ((time / duration) * 100).toFixed(2)
          const r = trackValueAt(track, time)
          if (!r) return ''
          const timing =
            r.exact && r.easing && r.easing !== 'linear'
              ? ` animation-timing-function:${r.easing};`
              : ''
          return `  ${pct}% { ${track.property}:${r.value};${timing} }`
        })
        .filter(Boolean)
        .join('\n')
      return { name: `${baseName}-${i}`, css: `@keyframes ${baseName}-${i} {\n${body}\n}` }
    })

  return { times, blocks }
}
