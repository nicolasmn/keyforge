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
            property: 'rotate',
            keyframes: [
              { id: nanoid(), time: 0, value: 'rotate(0deg)', easing: 'linear' },
              { id: nanoid(), time: 2400, value: 'rotate(360deg)', easing: 'linear' },
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

function normalize(css: string): string {
  return css
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}
