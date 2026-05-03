import type { AnimationDocument } from '@/types'
import { buildKeyframeBlock } from './keyframes'

/**
 * Generate the full CSS output for a single layer.
 *
 * Output is formatted for readability:
 *   - Section comment with the layer name
 *   - @keyframes block
 *   - animation shorthand properties
 *   - Blank line between each layer
 *
 * animation-play-state is `paused` so the browser never advances the
 * animation on its own — position is driven by animation-delay (see Preview).
 */
export function generateLayerCss(doc: AnimationDocument, layerId: string): string {
  const layer = doc.layers.find((l) => l.id === layerId)
  if (!layer) return ''
  if (layer.visible === false) return `/* Layer "${layer.name}" is hidden — no CSS emitted */`

  const hasKeyframes = layer.tracks.some((t) => t.keyframes.length > 0)
  if (!hasKeyframes) return `/* Layer "${layer.name}" has no keyframes yet */`

  const animName = `kf-${layer.id}`
  const { keyframeBlock } = buildKeyframeBlock(layer, doc.duration)
  if (!keyframeBlock.trim()) return ''

  return [
    `/* Layer: ${layer.name} */`,
    `@keyframes ${animName} {`,
    keyframeBlock,
    `}`,
    ``,
    `/* Apply animation to the layer element */`,
    `[data-layer-id="${layer.id}"] {`,
    `  animation-name: ${animName};`,
    `  animation-duration: ${doc.duration}ms;`,
    `  /* Timing drives per-keyframe easing, not the whole animation */`,
    `  animation-timing-function: linear;`,
    `  animation-fill-mode: both;`,
    `  animation-iteration-count: infinite;`,
    `  /* Paused: position set via negative animation-delay (see Preview) */`,
    `  animation-play-state: paused;`,
    `}`,
  ].join('\n')
}

/**
 * Generate CSS for the entire document.
 * Each layer gets a comment header + @keyframes + animation block.
 * Hidden layers and layers without keyframes are skipped.
 */
export function generateCss(doc: AnimationDocument): string {
  const layers = doc.layers
    .map((layer) => {
      if (layer.visible === false) return ''
      const hasKeyframes = layer.tracks.some((t) => t.keyframes.length > 0)
      if (!hasKeyframes) return ''

      const animName = `kf-${layer.id}`
      const { keyframeBlock } = buildKeyframeBlock(layer, doc.duration)
      if (!keyframeBlock.trim()) return ''

      return [
        `/* Layer: ${layer.name} */`,
        `@keyframes ${animName} {`,
        keyframeBlock,
        `}`,
        ``,
        `/* Apply animation to the layer element */`,
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

  if (layers.length === 0) return '/* No animated layers in document */'
  return layers.join('\n\n')
}
