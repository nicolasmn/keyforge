import type { Layer, AnimationDocument } from '@/types'

/**
 * Shared keyframe building logic used by both css.ts (preview) and export.ts (export).
 * Returns the sorted time offsets and the @keyframes block string for a single layer.
 */
export function buildKeyframeBlock(
  layer: Layer,
  duration: AnimationDocument['duration'],
): { times: number[]; keyframeBlock: string } {
  const times = [
    ...new Set(layer.tracks.flatMap((t) => t.keyframes.map((k) => k.time))),
  ].sort((a, b) => a - b)

  const keyframeBlock = times
    .map((time) => {
      const pct = ((time / duration) * 100).toFixed(2)
      const props = layer.tracks
        .map((track) => {
          const kf = [...track.keyframes].reverse().find((k) => k.time <= time)
          if (!kf) return ''
          return `${track.property}:${kf.value};`
        })
        .filter(Boolean)
        .join(' ')
      return `  ${pct}% { ${props} }`
    })
    .join('\n')

  return { times, keyframeBlock }
}
