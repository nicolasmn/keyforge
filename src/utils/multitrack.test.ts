import { describe, it, expect } from 'vitest'
import { generateCss } from './css'
import { parseCssToDoc } from './cssImport'
import { exportCss } from './export'
import type { AnimationDocument, Layer, Track } from '@/types'
import { nanoid } from './nanoid'

/**
 * Regression tests for "multiple transforms on the same layer overwrite
 * each other (last one wins)".
 *
 * Root cause: CSS animations of the SAME property cannot compose — per
 * css-animations-1 the animation later in the animation-name list overrides
 * earlier ones entirely. Two transform-TYPE tracks therefore emitted two
 * rules both animating `transform`, and the second silently killed the
 * first. Duplicate transform tracks are now merged into ONE composed
 * channel at generation time.
 */
function kf(id: string, time: number, value: string, easing = 'linear') {
  return { id, time, value, easing }
}
function tr(id: string, property: Track['property'], keyframes: ReturnType<typeof kf>[]): Track {
  return { id, property, keyframes }
}

function layer(name: string, tracks: Track[], id = nanoid()): Layer {
  return {
    id,
    name,
    visible: true,
    element: { tag: 'div', text: '', initialCss: '' },
    tracks,
  }
}

function doc(layers: Layer[]): AnimationDocument {
  return { id: nanoid(), name: 'MultiTransform', duration: 2000, layers }
}

function rulesAnimating(css: string, property: string): number {
  // count @keyframes bodies that declare the property
  let count = 0
  const re = /@keyframes [\w-]+ \{([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) if (m[1].includes(`${property}:`)) count++
  return count
}

describe('multi-transform layers compose instead of overriding', () => {
  const twoTransformTracks = () =>
    doc([
      layer('Box', [
        tr('t1', 'transform', [
          kf('k1', 0, 'translateY(0px)'),
          kf('k2', 2000, 'translateY(100px)'),
        ]),
        tr('t2', 'transform', [kf('k3', 0, 'rotate(0deg)'), kf('k4', 2000, 'rotate(90deg)')]),
      ]),
    ])

  it('emits exactly ONE rule animating transform', () => {
    const css = generateCss(twoTransformTracks())
    expect(rulesAnimating(css, 'transform')).toBe(1)
  })

  it('merged rule carries composed function stacks at every stop', () => {
    const css = generateCss(twoTransformTracks())
    expect(css).toContain('transform:translateY(0px) rotate(0deg)')
    expect(css).toContain('transform:translateY(100px) rotate(90deg)')
    // Every emitted transform declaration is a COMPOSED stack carrying both
    // tracks' functions — no declaration can clobber its sibling.
    const decls = css.match(/transform:[^;}]+/g) ?? []
    expect(decls.length).toBeGreaterThan(0)
    for (const d of decls) {
      expect(d).toContain('translateY(')
      expect(d).toContain('rotate(')
    }
  })

  it('animation-name lists every effective track once', () => {
    const css = generateCss(
      doc([
        layer('Box', [
          tr('t0', 'opacity', [kf('k0', 0, '0'), kf('kb', 2000, '1')]),
          tr('t1', 'transform', [kf('k1', 0, 'translateY(0px)')]),
          tr('t2', 'transform', [kf('k3', 0, 'rotate(0deg)'), kf('k4', 2000, 'rotate(90deg)')]),
        ]),
      ]),
    )
    const names = /animation-name: ([^;]+);/.exec(css)![1].split(', ').sort()
    // opacity + merged transform = 2 rules
    expect(names).toHaveLength(2)
    expect(rulesAnimating(css, 'transform')).toBe(1)
  })

  it('round-trips through import with motion preserved on one channel', () => {
    const css1 = generateCss(twoTransformTracks())
    const result = parseCssToDoc(css1)
    expect(result.doc).not.toBeNull()
    const box = result.doc!.layers[0]
    const transformTracks = box.tracks.filter((t) => t.property === 'transform')
    expect(transformTracks).toHaveLength(1)

    // re-export is stable and still single-channel
    const css2 = generateCss(result.doc!)
    expect(rulesAnimating(css2, 'transform')).toBe(1)
    // composed endpoints survive
    expect(css2).toContain('rotate(90deg)')
    expect(css2).toContain('translateY(100px)')
  })

  it('file export composes duplicate transform tracks too', () => {
    const css = exportCss(twoTransformTracks())
    expect(rulesAnimating(css, 'transform')).toBe(1)
    expect(css).toContain('transform:translateY(0px) rotate(0deg)')
    expect(css).toContain('transform:translateY(100px) rotate(90deg)')
  })

  it('eased duplicate tracks get sampled stops preserving both curves', () => {
    const eased = doc([
      layer('Ez', [
        tr('t1', 'transform', [
          kf('k1', 0, 'translateY(0px)', 'ease-out'),
          kf('k2', 2000, 'translateY(100px)'),
        ]),
        tr('t2', 'transform', [kf('k3', 0, 'rotate(0deg)'), kf('k4', 2000, 'rotate(90deg)')]),
      ]),
    ])
    const css = generateCss(eased)
    expect(rulesAnimating(css, 'transform')).toBe(1)
    // subdivision happened (more than the two boundary stops)
    const ruleBody = /@keyframes [\w-]+ \{([\s\S]*?)\n\}/.exec(css)![1]
    const stops = [...ruleBody.matchAll(/([\d.]+)% \{/g)].map((m) => m[1])
    expect(stops.length).toBeGreaterThan(2)
  })
})

describe('individual spatial properties stay separate channels', () => {
  it('does not merge a transform track with rotate/translate/scale tracks', () => {
    const d = doc([
      layer('Dot', [
        tr('t1', 'transform', [
          kf('k1', 0, 'translateX(0px)'),
          kf('k2', 2000, 'translateX(120px)'),
        ]),
        tr('t2', 'rotate', [kf('k3', 0, '45deg'), kf('k4', 2000, '405deg')]),
        tr('t3', 'scale', [kf('k5', 0, '1'), kf('k6', 2000, '2')]),
      ]),
    ])
    const css = generateCss(d)
    // three distinct animated properties → three rules
    expect(rulesAnimating(css, 'transform')).toBe(1)
    expect(rulesAnimating(css, 'rotate')).toBe(1)
    expect(rulesAnimating(css, 'scale')).toBe(1)
    expect(/animation-name: ([^;]+);/.exec(css)![1].split(', ')).toHaveLength(3)
  })

  it('sanitizes legacy function-style values on individual properties', () => {
    const d = doc([
      layer('Tri', [
        tr('t1', 'rotate', [kf('k1', 0, 'rotate(0deg)'), kf('k2', 2000, 'rotate(360deg)')]),
      ]),
    ])
    const css = generateCss(d)
    expect(css).toContain('rotate:0deg;')
    expect(css).toContain('rotate:360deg;')
    expect(css).not.toContain('rotate:rotate(')

    // and translate pairs use space separation
    const t = doc([
      layer('Quad', [
        tr('t1', 'translate', [
          kf('k1', 0, 'translate(0px, 0px)'),
          kf('k2', 2000, 'translate(80px, 40px)'),
        ]),
      ]),
    ])
    const cssT = generateCss(t)
    expect(cssT).toContain('translate:0px 0px;')
    expect(cssT).toContain('translate:80px 40px;')
  })
})
