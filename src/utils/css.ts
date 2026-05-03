import type { AnimationDocument } from '@/types'
import { buildKeyframeBlock } from './keyframes'

/**
 * Generate @keyframes + animation declaration for preview.
 *
 * - animation-play-state: paused — browser never advances on its own.
 * - animation-iteration-count: infinite — prevents fill-mode freeze.
 * - Position driven exclusively by animation-delay set as inline style by Preview.
 */
export function generateCss(doc: AnimationDocument): string {
  return doc.layers
    .map((layer) => {
      const animName = `kf-${layer.id}`
      const { times, keyframeBlock } = buildKeyframeBlock(layer, doc.duration)

      if (times.length === 0) return ''

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
    .join('\n\n')
}
