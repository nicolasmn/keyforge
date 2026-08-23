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
          visible: true,
          element: { tag: 'div', text: '', initialCss: '' },
          tracks: [{ id: 'track-1', property: 'opacity', keyframes: [] }],
        },
      ],
    })
    expect(generateCss(doc).trim()).toBe('')
  })

  it('returns empty string for hidden layer with keyframes', () => {
    const doc = makeDoc({
      layers: [
        {
          id: 'layer-1',
          name: 'Box',
          visible: false,
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
    expect(generateCss(doc).trim()).toBe('')
  })

  it('generates @keyframes block', () => {
    const doc = makeDoc({
      layers: [
        {
          id: 'layer-1',
          name: 'Box',
          visible: true,
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
    expect(css).toContain('@keyframes kf-box')
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
          visible: true,
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
    expect(css).toContain('[data-layer-id="box"]')
    expect(css).toContain('animation-name: kf-box')
    expect(css).toContain('animation-duration: 1000ms')
    expect(css).toContain('animation-play-state: paused')
  })

  it('handles multiple tracks at the same time offset', () => {
    const doc = makeDoc({
      layers: [
        {
          id: 'layer-1',
          name: 'Box',
          visible: true,
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

describe('generateCss — regression: rotate + transform tracks compose', () => {
  // User report: a layer with a rotate track ([0,1000,2500]ms → 0/0/360)
  // and a transform track ([0,1250]ms → translateY(40px)→translateY(0)),
  // duration 3000ms, showed "rotate not visible in the animation at all".
  // Root cause: rotate values stored in function syntax emitted invalid
  // `rotate:rotate(360deg)` declarations; Chrome drops them at parse time,
  // leaving computed `rotate` at none. The transform track was irrelevant.
  const makeLayer = (tracks: AnimationDocument['layers'][number]['tracks']) => ({
    id: 'layer-1',
    name: 'Box',
    visible: true,
    element: { tag: 'div', text: '', initialCss: '' },
    tracks,
  })

  it('emits valid individual-property syntax so both animations apply', () => {
    const doc = makeDoc({
      duration: 3000,
      layers: [
        makeLayer([
          {
            id: 'track-rot',
            property: 'rotate',
            keyframes: [
              { id: 'k1', time: 0, value: 'rotate(0deg)', easing: 'linear' },
              { id: 'k2', time: 1000, value: 'rotate(0deg)', easing: 'linear' },
              { id: 'k3', time: 2500, value: 'rotate(360deg)', easing: 'linear' },
            ],
          },
          {
            id: 'track-tr',
            property: 'transform',
            keyframes: [
              { id: 'k4', time: 0, value: 'translateY(40px)', easing: 'linear' },
              { id: 'k5', time: 1250, value: 'translateY(0px)', easing: 'linear' },
            ],
          },
        ]),
      ],
    })
    const css = generateCss(doc)

    // Both per-track rules referenced on the element.
    expect(css).toContain('@keyframes kf-box-0')
    expect(css).toContain('@keyframes kf-box-1')
    expect(css).toContain('animation-name: kf-box-0, kf-box-1')

    // Rotate stops are bare angles — the only syntax valid for `rotate:`.
    expect(css).toContain('rotate:0deg;')
    expect(css).toContain('rotate:360deg;')
    expect(css).not.toContain('rotate:rotate(')

    // Transform track keeps its function values.
    expect(css).toContain('transform:translateY(40px);')
    expect(css).toContain('transform:translateY(0px);')
  })

  it('already-valid rotate values pass through unchanged (idempotent emission)', () => {
    const doc = makeDoc({
      layers: [
        makeLayer([
          {
            id: 'track-rot',
            property: 'rotate',
            keyframes: [
              { id: 'k1', time: 0, value: '0deg', easing: 'linear' },
              { id: 'k2', time: 1000, value: '360deg', easing: 'linear' },
            ],
          },
        ]),
      ],
    })
    const css = generateCss(doc)
    expect(css).toContain('rotate:0deg;')
    expect(css).toContain('rotate:360deg;')
  })
})
