import { describe, it, expect } from 'vitest'
import { buildKeyframeBlock, buildSplitKeyframeBlocks } from './keyframes'
import type { Layer } from '@/types'
import { nanoid } from '@/utils/nanoid'

function makeLayer(tracks: Layer['tracks']): Layer {
  return {
    id: nanoid(),
    name: 'Test',
    visible: true,
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
        keyframes: [{ id: nanoid(), time: 500, value: '0.5', easing: 'linear' }],
      },
    ])
    const { times } = buildKeyframeBlock(layer, 1000)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBe(1000)
  })

  it('returns empty keyframeBlock for a layer with no keyframes', () => {
    const layer = makeLayer([{ id: nanoid(), property: 'opacity', keyframes: [] }])
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

describe('buildSplitKeyframeBlocks — individual-property syntax', () => {
  it('emits bare-angle values for a rotate track stored in function form', () => {
    // Regression: rotate tracks historically stored `rotate(360deg)`
    // (transform-function syntax). Emitted verbatim, `rotate:rotate(360deg)`
    // is invalid CSS for the individual `rotate` property — browsers drop
    // every declaration in the rule and the animation silently no-ops.
    const layer = makeLayer([
      {
        id: nanoid(),
        property: 'rotate',
        keyframes: [
          { id: nanoid(), time: 0, value: 'rotate(0deg)', easing: 'linear' },
          { id: nanoid(), time: 1000, value: 'rotate(180deg)', easing: 'linear' },
        ],
      },
    ])
    const { blocks } = buildSplitKeyframeBlocks(layer, 1000, 'kf-t')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].css).toContain('rotate:0deg;')
    expect(blocks[0].css).toContain('rotate:180deg;')
    expect(blocks[0].css).not.toContain('rotate:rotate(')
  })

  it('leaves transform-track function values untouched', () => {
    const layer = makeLayer([
      {
        id: nanoid(),
        property: 'transform',
        keyframes: [
          { id: nanoid(), time: 0, value: 'translateY(40px)', easing: 'linear' },
          { id: nanoid(), time: 1000, value: 'translateY(0px)', easing: 'linear' },
        ],
      },
    ])
    const { blocks } = buildSplitKeyframeBlocks(layer, 1000, 'kf-t')
    expect(blocks[0].css).toContain('transform:translateY(40px);')
    expect(blocks[0].css).toContain('transform:translateY(0px);')
  })
})
