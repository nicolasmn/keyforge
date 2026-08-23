import { describe, it, expect } from 'vitest'
import { generateCss } from './css'
import { parseCssToDoc } from './cssImport'
import type { AnimationDocument } from '@/types'
import { nanoid } from './nanoid'

function makeDoc(): AnimationDocument {
  return {
    id: nanoid(),
    name: 'RoundTrip',
    duration: 2400,
    layers: [
      {
        id: nanoid(),
        name: 'Box',
        visible: true,
        element: { tag: 'div', text: '', initialCss: '' },
        tracks: [
          {
            id: nanoid(),
            property: 'opacity',
            keyframes: [
              { id: nanoid(), time: 0, value: '0', easing: 'linear' },
              {
                id: nanoid(),
                time: 600,
                value: '0.8',
                easing: 'cubic-bezier(0.34,1.56,0.64,1)',
              },
              { id: nanoid(), time: 1800, value: '1', easing: 'ease-out' },
            ],
          },
          {
            id: nanoid(),
            property: 'transform',
            keyframes: [
              { id: nanoid(), time: 0, value: 'translateY(40px)', easing: 'linear' },
              { id: nanoid(), time: 1200, value: 'translateY(0px)', easing: 'ease-in-out' },
            ],
          },
        ],
      },
      {
        id: nanoid(),
        name: 'Dot',
        visible: true,
        element: { tag: 'div', text: '', initialCss: '' },
        tracks: [
          {
            id: nanoid(),
            // Individual-property track: bare angle values (css-transforms-2
            // syntax), not rotate() function values.
            property: 'rotate',
            keyframes: [
              { id: nanoid(), time: 0, value: '0deg', easing: 'linear' },
              { id: nanoid(), time: 2400, value: '360deg', easing: 'linear' },
            ],
          },
        ],
      },
    ],
  }
}

/** Compare documents ignoring ids/names of generated entities.
 *  Layer names are compared case-insensitively: CSS @keyframes names are
 *  case-insensitive identifiers, and keyforge slugs them for export. */
function docShape(d: AnimationDocument) {
  return {
    duration: d.duration,
    layers: d.layers.map((l) => ({
      name: l.name.toLowerCase(),
      tracks: [...l.tracks]
        .sort((a, b) => a.property.localeCompare(b.property))
        .map((t) => ({
          property: t.property,
          kfs: t.keyframes
            .slice()
            .sort((a, b) => a.time - b.time)
            .map((k) => ({ time: k.time, value: k.value, easing: k.easing })),
        })),
    })),
  }
}

describe('CSS round-trip: export → import → export', () => {
  it('re-importing keyforge export preserves times, values, easings', () => {
    const doc1 = makeDoc()
    const css1 = generateCss(doc1)

    // Always-split reality: one @keyframes rule PER TRACK, named kf-<slug>-<i>.
    expect(css1).toContain('@keyframes kf-box-0')
    expect(css1).toContain('@keyframes kf-box-1')
    expect(css1).toContain('@keyframes kf-dot-0')
    expect(css1).toContain('animation-name: kf-box-0, kf-box-1')

    const result = parseCssToDoc(css1)
    expect(result.doc).not.toBeNull()
    const doc2 = result.doc!

    // Same CSS out the other side (modulo whitespace) — the real guarantee.
    const css2 = generateCss(doc2)
    expect(normalize(css2)).toBe(normalize(css1))

    // And the shape matches too.
    expect(docShape(doc2)).toEqual(docShape(doc1))
  })

  it('is stable across a second cycle (idempotent)', () => {
    const doc1 = makeDoc()
    const css1 = normalize(generateCss(doc1))
    const doc2 = parseCssToDoc(generateCss(doc1)).doc!
    const css2 = normalize(generateCss(doc2))
    const doc3 = parseCssToDoc(css2).doc!
    const css3 = normalize(generateCss(doc3))
    expect(css3).toBe(css1)
    expect(docShape(doc3)).toEqual(docShape(doc2))
  })

  it('preserves per-keyframe non-linear easing through the loop', () => {
    const doc1 = makeDoc()
    const css1 = generateCss(doc1)
    expect(css1).toContain('animation-timing-function:cubic-bezier(0.34,1.56,0.64,1)')
    const doc2 = parseCssToDoc(css1).doc!
    const boxOpacity = doc2.layers[0].tracks.find((t) => t.property === 'opacity')!
    const mid = boxOpacity.keyframes.find((k) => k.time === 600)!
    expect(mid!.easing).toContain('cubic-bezier')
  })

  it('preserves document duration via the companion block', () => {
    const doc1 = makeDoc()
    const doc2 = parseCssToDoc(generateCss(doc1)).doc!
    expect(doc2.duration).toBe(2400)
  })
})

/**
 * Regression: with one SHARED @keyframes rule per layer, stops sat at the
 * union of ALL tracks' keyframe times — sibling tracks got false "hold"
 * stops where they had no keyframe. Symptom: opacity keys at 0ms/5000ms +
 * transform keys at 0ms/3000ms (duration 5000) made the shared rule carry a
 * 60% stop, so opacity only visibly animated 3s→5s instead of 0→5s.
 * Per-track rules keep every timeline pure.
 */
describe("regression: sibling tracks must not pollute each other's timeline", () => {
  function bugDoc(): AnimationDocument {
    return {
      id: nanoid(),
      name: 'Bug',
      duration: 5000,
      layers: [
        {
          id: nanoid(),
          name: 'Box',
          visible: true,
          element: { tag: 'div', text: '', initialCss: '' },
          tracks: [
            {
              id: nanoid(),
              property: 'opacity',
              keyframes: [
                { id: nanoid(), time: 0, value: '0', easing: 'linear' },
                { id: nanoid(), time: 5000, value: '1', easing: 'linear' },
              ],
            },
            {
              id: nanoid(),
              property: 'transform',
              keyframes: [
                { id: nanoid(), time: 0, value: 'translateY(40px)', easing: 'linear' },
                { id: nanoid(), time: 3000, value: 'translateY(0px)', easing: 'linear' },
              ],
            },
          ],
        },
      ],
    }
  }

  function keyframesRule(css: string, name: string): string {
    const start = css.indexOf(`@keyframes ${name} {`)
    if (start === -1) return ''
    const open = css.indexOf('{', start)
    let depth = 1
    let i = open + 1
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    return css.slice(open + 1, i - 1)
  }

  function stopsOf(ruleBody: string): number[] {
    return [...ruleBody.matchAll(/([\d.]+)%\s*\{/g)].map((m) => Number.parseFloat(m[1]))
  }

  it('opacity rule has only its own 0%/100% stops; transform keeps its 60% stop', () => {
    const css = generateCss(bugDoc())
    const opacityRule = keyframesRule(css, 'kf-box-0')
    const transformRule = keyframesRule(css, 'kf-box-1')

    // Opacity timeline is pure: no 60% hold polluting its 0→100% ramp.
    expect(stopsOf(opacityRule)).toEqual([0, 100])

    // Transform still animates over its real range, ending in a boundary
    // hold at 100% (its last key is at 60% of a 5000ms document).
    expect(stopsOf(transformRule)).toEqual([0, 60, 100])
    expect(transformRule).toContain('translateY(40px)')
    expect(transformRule).toContain('translateY(0px)')
  })

  it('importing the export restores full-range interpolation for opacity', () => {
    const css1 = generateCss(bugDoc())
    const doc2 = parseCssToDoc(css1).doc!

    // Split rules merged back into ONE layer named after the base.
    expect(doc2.layers).toHaveLength(1)
    expect(doc2.layers[0].name.toLowerCase()).toBe('box')

    // Opacity interpolates across its WHOLE range: exactly 2 keyframes.
    const opacity = doc2.layers[0].tracks.find((t) => t.property === 'opacity')!
    expect(opacity.keyframes.map((k) => [k.time, k.value])).toEqual([
      [0, '0'],
      [5000, '1'],
    ])

    // Transform boundary hold dropped; real keys remain.
    const transform = doc2.layers[0].tracks.find((t) => t.property === 'transform')!
    expect(transform.keyframes.map((k) => [k.time, k.value])).toEqual([
      [0, 'translateY(40px)'],
      [3000, 'translateY(0px)'],
    ])

    // Round-trip stays CSS-identical.
    expect(normalize(generateCss(doc2))).toBe(normalize(css1))
  })
})

function normalize(css: string): string {
  return css
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}
