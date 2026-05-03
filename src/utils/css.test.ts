import { describe, it, expect } from 'vitest'
import { generateCss } from './css'
import type { AnimationDocument } from '@/types'

const makeDoc = (overrides: Partial<AnimationDocument> = {}): AnimationDocument => ({
  id: 'doc-1',
  name: 'Test',
  duration: 1000,
  layers: [],
  ...overrides,
})

describe('generateCss', () => {
  it('returns empty string for doc with no layers', () => {
    expect(generateCss(makeDoc())).toBe('')
  })

  it('returns empty string for layer with no keyframes', () => {
    const doc = makeDoc({
      layers: [
        {
          id: 'layer-1',
          name: 'Box',
          element: { tag: 'div', text: '', initialCss: '' },
          tracks: [{ id: 'track-1', property: 'opacity', keyframes: [] }],
        },
      ],
    })
    expect(generateCss(doc).trim()).toBe('')
  })

  it('generates @keyframes block', () => {
    const doc = makeDoc({
      layers: [
        {
          id: 'layer-1',
          name: 'Box',
          element: { tag: 'div', text: '', initialCss: '' },
          tracks: [
            {
              id: 'track-1',
              property: 'opacity',
              keyframes: [
                { id: 'kf-1', time: 0, value: '0', easing: 'ease-out' },
                { id: 'kf-2', time: 1000, value: '1', easing: 'ease-out' },
              ],
            },
          ],
        },
      ],
    })
    const css = generateCss(doc)
    expect(css).toContain('@keyframes kf-layer-1')
    expect(css).toContain('0.00%')
    expect(css).toContain('100.00%')
    expect(css).toContain('opacity:0')
    expect(css).toContain('opacity:1')
  })

  it('includes animation declaration on layer selector', () => {
    const doc = makeDoc({
      layers: [
        {
          id: 'layer-1',
          name: 'Box',
          element: { tag: 'div', text: '', initialCss: '' },
          tracks: [
            {
              id: 'track-1',
              property: 'opacity',
              keyframes: [{ id: 'kf-1', time: 0, value: '0', easing: 'linear' }],
            },
          ],
        },
      ],
    })
    const css = generateCss(doc)
    expect(css).toContain('[data-layer-id="layer-1"]')
    // css.ts emits longhand animation properties, not the shorthand
    expect(css).toContain('animation-name: kf-layer-1')
    expect(css).toContain('animation-duration: 1000ms')
    expect(css).toContain('animation-play-state: paused')
  })

  it('handles multiple tracks at the same time offset', () => {
    const doc = makeDoc({
      layers: [
        {
          id: 'layer-1',
          name: 'Box',
          element: { tag: 'div', text: '', initialCss: '' },
          tracks: [
            {
              id: 'track-1',
              property: 'opacity',
              keyframes: [{ id: 'kf-1', time: 0, value: '0', easing: 'linear' }],
            },
            {
              id: 'track-2',
              property: 'transform',
              keyframes: [{ id: 'kf-2', time: 0, value: 'translateY(40px)', easing: 'linear' }],
            },
          ],
        },
      ],
    })
    const css = generateCss(doc)
    expect(css).toContain('opacity:0')
    expect(css).toContain('transform:translateY(40px)')
  })
})
