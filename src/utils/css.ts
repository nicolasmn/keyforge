import type { AnimationDocument } from '@/types'
import { buildKeyframeBlock } from './keyframes'

/**
 * Generate @keyframes + animation declaration for preview.
 *
 * - animation-play-state: paused — browser never advances on its own.
 * - animation-iteration-count: infinite — prevents fill-mode freeze.
 * - Position driven exclusively by animation-delay set as inline style by Preview.
 *
 * Skips layers that are hidden (visible === false) or have no keyframes on any track.
 */
export function generateCss(doc: AnimationDocument): string {
  return doc.layers
    .map((layer) => {
      // Skip hidden layers
      if (layer.visible === false) return ''

      // Skip layers where every track has zero keyframes
      const hasKeyframes = layer.tracks.some((t) => t.keyframes.length > 0)
      if (!hasKeyframes) return ''

      const animName = `kf-${layer.id}`
      const { keyframeBlock } = buildKeyframeBlock(layer, doc.duration)

      if (!keyframeBlock.trim()) return ''

      return [
        `@keyframes ${animName} {`,
        keyframeBlock,
        `}`,
        `[data-layer-id="${layer.id}"] {`,
        `  animation-name: ${animName};`,
        `  animation-duration: ${doc.duration}ms;`,
        `  animation-timing-function: linear;`,
        `  animation-fill-mode: both;`,
        `  animation-iteration-count: infinite;`,
        `  animation-play-state: paused;`,
        `}`,
      ].join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}
