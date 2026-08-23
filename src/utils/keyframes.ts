import type { Layer, AnimationDocument } from '@/types'

/**
 * Shared keyframe building logic used by css.ts (preview) and export.ts (export).
 *
 * For each unique time offset across all tracks, resolves the value for every
 * track using the last keyframe at-or-before that time (stepped/hold interpolation).
 * Returns sorted time offsets and the rendered @keyframes block string.
 */
export function buildKeyframeBlock(
  layer: Layer,
  duration: AnimationDocument['duration'],
): { times: number[]; keyframeBlock: string } {
  // Collect all unique times across all tracks, always include 0 and duration
  // so the browser has explicit start/end frames and doesn't guess
  const rawTimes = layer.tracks.flatMap((t) => t.keyframes.map((k) => k.time))
  const times = [...new Set([0, ...rawTimes, duration])].sort((a, b) => a - b)

  const keyframeBlock = times
    .map((time) => {
      const pct = ((time / duration) * 100).toFixed(2)
      const props = layer.tracks
        .map((track) => {
          const sorted = [...track.keyframes].sort((a, b) => a.time - b.time)
          if (sorted.length === 0) return ''
          // Exact keyframe at this time: emit its value AND its easing so
          // export→import round-trips per-stop timing functions.
          const exact = sorted.find((k) => k.time === time)
          if (exact) {
            const timing =
              exact.easing && exact.easing !== 'linear'
                ? ` animation-timing-function:${exact.easing};`
                : ''
            return `${track.property}:${exact.value};${timing}`
          }
          // Gap time: hold the last keyframe at-or-before (existing semantics).
          const kf = [...sorted].reverse().find((k) => k.time <= time)
          const active = kf ?? sorted[0]
          return `${track.property}:${active.value};`
        })
        .filter(Boolean)
        .join(' ')
      if (!props) return ''
      return `  ${pct}% { ${props} }`
    })
    .filter(Boolean)
    .join('\n')

  return { times, keyframeBlock }
}
