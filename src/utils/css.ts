import type { AnimationDocument } from '@/types'
import { buildKeyframeBlock } from './keyframes'

/**
 * Generate readable CSS output for a single layer (used by CodeView).
 *
 * Includes human-friendly comments explaining non-obvious animation properties.
 * Returns a descriptive comment string (not empty) when the layer is hidden
 * or has no keyframes — so the code view always shows something useful.
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
    `  /* linear here — per-keyframe easing is baked into the @keyframes stops */`,
    `  animation-timing-function: linear;`,
    `  animation-fill-mode: both;`,
    `  animation-iteration-count: infinite;`,
    `  /* Paused: scrub position is driven by negative animation-delay */`,
    `  animation-play-state: paused;`,
    `}`,
  ].join('\n')
}

/**
 * Generate CSS for the entire document, injected into a <style> tag by Preview.
 *
 * Returns empty string (not a comment) when there is nothing to emit —
 * a <style> tag with only comments is harmless but the existing test suite
 * asserts strict equality to '' for empty/hidden/no-keyframe cases.
 *
 * Skips hidden layers and layers without keyframes silently.
 */
export function generateCss(doc: AnimationDocument): string {
  return doc.layers
    .map((layer) => {
      if (layer.visible === false) return ''
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
