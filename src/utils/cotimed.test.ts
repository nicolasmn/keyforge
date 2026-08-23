import { describe, it, expect } from 'vitest'
import { generateCss } from './css'
import { hasCoTimedEasingConflict, buildSplitKeyframeBlocks } from './keyframes'
import type { AnimationDocument } from '@/types'
import { nanoid } from './nanoid'

function conflictDoc(): AnimationDocument {
  return {
    id: nanoid(),
    name: 'Conflict',
    duration: 2000,
    layers: [
      {
        id: 'L1',
        name: 'Box',
        visible: true,
        element: { tag: 'div', text: '', initialCss: '' },
        tracks: [
          {
            id: 'T1',
            property: 'opacity',
            keyframes: [
              // co-timed at 0 with DIFFERENT non-linear easings
              { id: 'K1', time: 0, value: '0', easing: 'cubic-bezier(0.34,1.56,0.64,1)' },
              { id: 'K2', time: 1000, value: '1', easing: 'linear' },
            ],
          },
          {
            id: 'T2',
            property: 'transform',
            keyframes: [
              { id: 'K3', time: 0, value: 'translateY(40px)', easing: 'ease-in-out' },
              { id: 'K4', time: 1000, value: 'translateY(0px)', easing: 'linear' },
            ],
          },
        ],
      },
    ],
  }
}

describe('co-timed easing conflicts', () => {
  it('detects conflicting non-linear easings at a shared stop', () => {
    expect(hasCoTimedEasingConflict(conflictDoc().layers[0])).toBe(true)
  })

  it('does not flag mixed linear/non-linear (linear is neutral)', () => {
    const doc = conflictDoc()
    doc.layers[0].tracks[1].keyframes[0].easing = 'linear'
    expect(hasCoTimedEasingConflict(doc.layers[0])).toBe(false)
  })

  it('splits into per-track keyframes rules when conflicted', () => {
    const css = generateCss(conflictDoc())
    expect(css).toContain('@keyframes kf-box-0')
    expect(css).toContain('@keyframes kf-box-1')
    expect(css).toContain('animation-name: kf-box-0, kf-box-1')
  })

  it('each split rule carries its own property and easing', () => {
    const css = generateCss(conflictDoc())
    const [block0, block1] = css.split('@keyframes kf-box-').slice(1)
    expect(block0).toContain('opacity:0;')
    expect(block0).toContain('cubic-bezier(0.34,1.56,0.64,1)')
    expect(block1).toContain('transform:translateY(40px);')
    expect(block1).toContain('ease-in-out')
  })

  it('non-conflicted layers keep the single-rule output', () => {
    const doc = conflictDoc()
    doc.layers[0].tracks[1].keyframes[0].easing = 'linear'
    const css = generateCss(doc)
    expect(css).not.toContain('kf-box-0')
    expect(css).toContain('@keyframes kf-box {')
  })

  it('split blocks builder produces valid css per track', () => {
    const layer = conflictDoc().layers[0]
    const { blocks } = buildSplitKeyframeBlocks(layer, 2000, 'kf-test')
    expect(blocks).toHaveLength(2)
    for (const b of blocks) {
      expect(b.css.startsWith('@keyframes kf-test-')).toBe(true)
      expect(b.css).toContain('0.00%')
      expect(b.css).toContain('100.00%')
    }
  })
})
