import type { AnimationDocument } from '@/types'

/**
 * Generate @keyframes + animation declaration for all layers.
 * play-state and delay are NOT baked in — Preview sets them directly on elements.
 */
export function generateCss(doc: AnimationDocument): string {
  return doc.layers
    .map((layer) => {
      const animName = `kf-${layer.id}`

      const times = [
        ...new Set(layer.tracks.flatMap((t) => t.keyframes.map((k) => k.time))),
      ].sort((a, b) => a - b)

      if (times.length === 0) return ''

      const keyframeBlock = times
        .map((time) => {
          const pct = ((time / doc.duration) * 100).toFixed(2)
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

      return [
        `@keyframes ${animName} {`,
        keyframeBlock,
        `}`,
        // iteration-count: infinite so fill-mode never freezes the element
        // play-state and delay are set directly by Preview via inline style
        `[data-layer-id="${layer.id}"] {`,
        `  animation-name: ${animName};`,
        `  animation-duration: ${doc.duration}ms;`,
        `  animation-timing-function: linear;`,
        `  animation-fill-mode: both;`,
        `  animation-iteration-count: infinite;`,
        `}`,
      ].join('\n')
    })
    .join('\n\n')
}
