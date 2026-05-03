import type { AnimationDocument } from '@/types'
import { buildKeyframeBlock } from './keyframes'

/**
 * Generate @keyframes + animation declaration for preview.
 *
 * - animation-play-state: paused — browser never advances on its own.
 * - animation-iteration-count: infinite — prevents fill-mode freeze.
 * - Position driven exclusively by animation-delay set as inline style by Preview.
 *
 * Layers with no keyframes on any track are skipped entirely.
 */
export function generateCss(doc: AnimationDocument): string {
  return doc.layers
    .map((layer) => {
      const animName = `kf-${layer.id}`
      const { times, keyframeBlock } = buildKeyframeBlock(layer, doc.duration)

      // Skip layers where every track has zero keyframes
      const hasKeyframes = layer.tracks.some((t) => t.keyframes.length > 0)
      if (!hasKeyframes) return ''

      // times always includes 0 and duration; only skip if truly nothing was built
      if (times.length === 0 || !keyframeBlock.trim()) return ''

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
