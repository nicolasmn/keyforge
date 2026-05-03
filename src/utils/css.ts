import type { AnimationDocument } from '@/types'

/**
 * Generate a full <style> block for all layers in the document.
 * Each layer gets a unique @keyframes rule and animation declaration.
 */
export function generateCss(doc: AnimationDocument): string {
  return doc.layers
    .map((layer) => {
      const animName = `kf-${layer.id}`

      // Collect all unique time offsets across all tracks
      const times = [
        ...new Set(layer.tracks.flatMap((t) => t.keyframes.map((k) => k.time))),
      ].sort((a, b) => a - b)

      if (times.length === 0) return ''

      const keyframeBlock = times
        .map((time) => {
          const pct = ((time / doc.duration) * 100).toFixed(2)
          const props = layer.tracks
            .map((track) => {
              // Find nearest keyframe at or before this time
              const kf = [...track.keyframes]
                .reverse()
                .find((k) => k.time <= time)
              if (!kf) return ''
              const prop = track.property === 'transform' || track.property === 'scale' ||
                track.property === 'translate' || track.property === 'rotate'
                ? track.property
                : track.property
              return `${prop}:${kf.value};`
            })
            .filter(Boolean)
            .join(' ')
          return `  ${pct}% { ${props} }`
        })
        .join('\n')

      return [
        `@keyframes ${animName} {`,
        keyframeBlock,
        `}`,
        `[data-layer-id="${layer.id}"] {`,
        `  animation: ${animName} ${doc.duration}ms linear both;`,
        `  animation-play-state: var(--play-state, paused);`,
        `}`,
      ].join('\n')
    })
    .join('\n\n')
}
