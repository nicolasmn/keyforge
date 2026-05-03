import { describe, it, expect } from 'vitest'
import { buildKeyframeBlock } from './keyframes'
import type { Layer } from '@/types'
import { nanoid } from '@/utils/nanoid'

function makeLayer(tracks: Layer['tracks']): Layer {
  return {
    id: nanoid(),
    name: 'Test',
    element: { tag: 'div', text: '', initialCss: '' },
    tracks,
  }
}

describe('buildKeyframeBlock', () => {
  it('always includes 0% and 100% stops', () => {
    const layer = makeLayer([
      {
        id: nanoid(),
        property: 'opacity',
        keyframes: [
          { id: nanoid(), time: 500, value: '0.5', easing: 'linear' },
        ],
      },
    ])
    const { times } = buildKeyframeBlock(layer, 1000)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBe(1000)
  })

  it('returns empty keyframeBlock for a layer with no keyframes', () => {
    const layer = makeLayer([
      { id: nanoid(), property: 'opacity', keyframes: [] },
    ])
    const { keyframeBlock } = buildKeyframeBlock(layer, 1000)
    expect(keyframeBlock).toBe('')
  })

  it('uses first keyframe value before first keyframe time', () => {
    const layer = makeLayer([
      {
        id: nanoid(),
        property: 'opacity',
        keyframes: [
          { id: nanoid(), time: 500, value: '0.5', easing: 'linear' },
          { id: nanoid(), time: 1000, value: '1', easing: 'linear' },
        ],
      },
    ])
    const { keyframeBlock } = buildKeyframeBlock(layer, 1000)
    // 0% stop should use the first keyframe value (0.5) since nothing before 500ms
    expect(keyframeBlock).toContain('0.00%')
    const line = keyframeBlock.split('\n').find((l) => l.includes('0.00%'))!
    expect(line).toContain('opacity:0.5')
  })

  it('holds last keyframe value after its time', () => {
    const layer = makeLayer([
      {
        id: nanoid(),
        property: 'opacity',
        keyframes: [
          { id: nanoid(), time: 0, value: '0', easing: 'linear' },
          { id: nanoid(), time: 500, value: '1', easing: 'linear' },
        ],
      },
    ])
    const { keyframeBlock } = buildKeyframeBlock(layer, 1000)
    // 100% stop should hold the last keyframe value (1)
    const line = keyframeBlock.split('\n').find((l) => l.includes('100.00%'))!
    expect(line).toContain('opacity:1')
  })

  it('deduplicates times from multiple tracks', () => {
    const layer = makeLayer([
      {
        id: nanoid(),
        property: 'opacity',
        keyframes: [
          { id: nanoid(), time: 0, value: '0', easing: 'linear' },
          { id: nanoid(), time: 500, value: '1', easing: 'linear' },
        ],
      },
      {
        id: nanoid(),
        property: 'transform',
        keyframes: [
          { id: nanoid(), time: 0, value: 'translateY(40px)', easing: 'linear' },
          { id: nanoid(), time: 500, value: 'translateY(0px)', easing: 'linear' },
        ],
      },
    ])
    const { times } = buildKeyframeBlock(layer, 1000)
    // 0, 500, 1000 — no duplicates
    expect(times).toEqual([0, 500, 1000])
  })

  it('renders both track properties at shared time stops', () => {
    const layer = makeLayer([
      {
        id: nanoid(),
        property: 'opacity',
        keyframes: [
          { id: nanoid(), time: 0, value: '0', easing: 'linear' },
          { id: nanoid(), time: 1000, value: '1', easing: 'linear' },
        ],
      },
      {
        id: nanoid(),
        property: 'transform',
        keyframes: [
          { id: nanoid(), time: 0, value: 'translateY(40px)', easing: 'linear' },
          { id: nanoid(), time: 1000, value: 'translateY(0px)', easing: 'linear' },
        ],
      },
    ])
    const { keyframeBlock } = buildKeyframeBlock(layer, 1000)
    const zeroLine = keyframeBlock.split('\n').find((l) => l.includes('0.00%'))!
    expect(zeroLine).toContain('opacity:0')
    expect(zeroLine).toContain('transform:translateY(40px)')
  })
})
