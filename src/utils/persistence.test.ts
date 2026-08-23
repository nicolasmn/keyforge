import { describe, it, expect } from 'vitest'
import { serializeDoc, deserializeDoc, validatePersisted, STORAGE_KEY } from './persistence'
import type { AnimationDocument } from '@/types'

const validDoc: AnimationDocument = {
  id: 'D1',
  name: 'Test',
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
          keyframes: [{ id: 'K1', time: 0, value: '0', easing: 'linear' }],
        },
      ],
    },
  ],
}

describe('persistence round-trip', () => {
  it('serializes and deserializes losslessly', () => {
    const restored = deserializeDoc(serializeDoc(validDoc))
    expect(restored).toEqual(validDoc)
  })

  it('stamps version and savedAt', () => {
    const parsed = JSON.parse(serializeDoc(validDoc))
    expect(parsed.version).toBe(1)
    expect(typeof parsed.savedAt).toBe('number')
  })

  it('uses a stable storage key', () => {
    expect(STORAGE_KEY).toBe('keyforge:doc:v1')
  })
})

describe('deserializeDoc rejects malformed payloads', () => {
  it('returns null for null/empty/garbage', () => {
    expect(deserializeDoc(null)).toBeNull()
    expect(deserializeDoc('')).toBeNull()
    expect(deserializeDoc('not json{')).toBeNull()
    expect(deserializeDoc('42')).toBeNull()
  })

  it('returns null for wrong version', () => {
    expect(deserializeDoc(JSON.stringify({ version: 2, doc: validDoc }))).toBeNull()
    expect(deserializeDoc(JSON.stringify({ doc: validDoc }))).toBeNull()
  })

  it('returns null when doc shape is broken', () => {
    const cases = [
      {},
      { version: 1 },
      { version: 1, doc: {} },
      { version: 1, doc: { id: 'D1' } },
      { version: 1, doc: { ...validDoc, duration: -5 } },
      { version: 1, doc: { ...validDoc, duration: Number.NaN } },
      { version: 1, doc: { ...validDoc, layers: 'nope' } },
      { version: 1, doc: { ...validDoc, layers: [{ id: 'L1' }] } },
      {
        version: 1,
        doc: {
          ...validDoc,
          layers: [
            {
              ...validDoc.layers[0],
              tracks: [{ id: 'T1', property: 'opacity', keyframes: [{ id: 'K1' }] }],
            },
          ],
        },
      },
      {
        version: 1,
        doc: {
          ...validDoc,
          layers: [
            {
              ...validDoc.layers[0],
              tracks: [
                {
                  id: 'T1',
                  property: 'opacity',
                  keyframes: [{ id: 'K1', time: 'zero', value: '0', easing: 'linear' }],
                },
              ],
            },
          ],
        },
      },
    ]
    for (const c of cases) {
      expect(validatePersisted(c), JSON.stringify(c).slice(0, 60)).toBeNull()
    }
  })

  it('accepts an empty layers array (legitimate cleared document)', () => {
    const empty = { ...validDoc, layers: [] }
    expect(validatePersisted({ version: 1, savedAt: 1, doc: empty })).toEqual(empty)
  })
})
