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
          // Find the active keyframe: last one at or before this time
          const sorted = [...track.keyframes].sort((a, b) => a.time - b.time)
          const kf = [...sorted].reverse().find((k) => k.time <= time)
          // If no keyframe yet (time is before first kf), use the first one
          const active = kf ?? sorted[0]
          if (!active) return ''
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
