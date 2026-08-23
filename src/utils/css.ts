import type { AnimationDocument } from '@/types'
import { buildKeyframeBlock, hasCoTimedEasingConflict, buildSplitKeyframeBlocks } from './keyframes'
import { slugify } from './slugify'

export function generateLayerCss(doc: AnimationDocument, layerId: string): string {
  const layer = doc.layers.find((l) => l.id === layerId)
  if (!layer) return ''
  if (layer.visible === false) return `/* "${layer.name}" is hidden */`

  const hasKeyframes = layer.tracks.some((t) => t.keyframes.length > 0)
  if (!hasKeyframes) return `/* "${layer.name}" has no keyframes yet */`

  const slug = slugify(layer.name)
  const animName = `kf-${slug}`

  // Co-timed stops with differing easings can't share one @keyframes rule
  // (CSS last-wins would corrupt a curve) — split per track when needed.
  if (hasCoTimedEasingConflict(layer)) {
    const { blocks } = buildSplitKeyframeBlocks(layer, doc.duration, animName)
    const names = blocks.map((b) => b.name).join(', ')
    return [
      ...blocks.map((b) => b.css),
      ``,
      `[data-layer-id="${slug}"] {`,
      `  animation-name: ${names};`,
      `  animation-duration: ${doc.duration}ms;`,
      `  animation-timing-function: linear;`,
      `  animation-fill-mode: both;`,
      `  animation-iteration-count: infinite;`,
      `  animation-play-state: paused;`,
      `}`,
    ].join('\n')
  }

  const { keyframeBlock } = buildKeyframeBlock(layer, doc.duration)
  if (!keyframeBlock.trim()) return ''

  return [
    `@keyframes ${animName} {`,
    keyframeBlock,
    `}`,
    ``,
    `[data-layer-id="${slug}"] {`,
    `  animation-name: ${animName};`,
    `  animation-duration: ${doc.duration}ms;`,
    `  animation-timing-function: linear;`,
    `  animation-fill-mode: both;`,
    `  animation-iteration-count: infinite;`,
    `  animation-play-state: paused;`,
    `}`,
  ].join('\n')
}

export function generateCss(doc: AnimationDocument): string {
  return doc.layers
    .map((layer) => {
      if (layer.visible === false) return ''
      const hasKeyframes = layer.tracks.some((t) => t.keyframes.length > 0)
      if (!hasKeyframes) return ''

      const slug = slugify(layer.name)
      const animName = `kf-${slug}`

      if (hasCoTimedEasingConflict(layer)) {
        const { blocks } = buildSplitKeyframeBlocks(layer, doc.duration, animName)
        const names = blocks.map((b) => b.name).join(', ')
        return [
          ...blocks.map((b) => b.css),
          `[data-layer-id="${slug}"] {`,
          `  animation-name: ${names};`,
          `  animation-duration: ${doc.duration}ms;`,
          `  animation-timing-function: linear;`,
          `  animation-fill-mode: both;`,
          `  animation-iteration-count: infinite;`,
          `  animation-play-state: paused;`,
          `}`,
        ].join('\n')
      }

      const { keyframeBlock } = buildKeyframeBlock(layer, doc.duration)
      if (!keyframeBlock.trim()) return ''

      return [
        `@keyframes ${animName} {`,
        keyframeBlock,
        `}`,
        `[data-layer-id="${slug}"] {`,
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
