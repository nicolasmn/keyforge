import type { AnimationDocument } from '@/types'
import { buildSplitKeyframeBlocks } from './keyframes'
import { slugify } from './slugify'

/**
 * One @keyframes rule PER TRACK, always. Within a single @keyframes rule all
 * properties share one percentage timeline — a shared rule would inject false
 * "hold" stops into sibling tracks at times where they have no keyframe of
 * their own, breaking smooth interpolation (e.g. transform keys at 0–3s +
 * opacity keys at 0–5s made opacity only visibly animate 3→5s). Splitting per
 * track keeps each property's timeline pure; the element references all rules
 * on its animation-name list.
 */

export function generateLayerCss(doc: AnimationDocument, layerId: string): string {
  const layer = doc.layers.find((l) => l.id === layerId)
  if (!layer) return ''
  if (layer.visible === false) return `/* "${layer.name}" is hidden */`

  const hasKeyframes = layer.tracks.some((t) => t.keyframes.length > 0)
  if (!hasKeyframes) return `/* "${layer.name}" has no keyframes yet */`

  const slug = slugify(layer.name)
  const animName = `kf-${slug}`

  const { blocks } = buildSplitKeyframeBlocks(layer, doc.duration, animName)
  if (blocks.length === 0) return ''
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

export function generateCss(doc: AnimationDocument): string {
  return doc.layers
    .map((layer) => {
      if (layer.visible === false) return ''
      const hasKeyframes = layer.tracks.some((t) => t.keyframes.length > 0)
      if (!hasKeyframes) return ''

      const slug = slugify(layer.name)
      const animName = `kf-${slug}`

      const { blocks } = buildSplitKeyframeBlocks(layer, doc.duration, animName)
      if (blocks.length === 0) return ''
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
    })
    .filter(Boolean)
    .join('\n\n')
}
