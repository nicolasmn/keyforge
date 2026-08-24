import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  serializeDoc,
  deserializeDoc,
  validatePersisted,
  STORAGE_KEY,
  ONBOARDING_KEY,
  hasOnboarded,
  markOnboarded,
  clearOnboarded,
} from './persistence'
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

describe('onboarding flag', () => {
  // Node's test env has no localStorage — stub a minimal Storage so the
  // real read/write logic is exercised, and restore afterwards.
  let backing: Map<string, string> | null = null
  afterEach(() => {
    vi.unstubAllGlobals()
    backing = null
  })

  function stubStorage() {
    backing = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (backing as Map<string, string>).get(k) ?? null,
      setItem: (k: string, v: string) => void (backing as Map<string, string>).set(k, v),
      removeItem: (k: string) => void (backing as Map<string, string>).delete(k),
    })
  }

  it('uses the keyforge:onboarded key', () => {
    expect(ONBOARDING_KEY).toBe('keyforge:onboarded')
  })

  it('round-trips mark → has → clear', () => {
    stubStorage()
    expect(hasOnboarded()).toBe(false)
    markOnboarded()
    expect(hasOnboarded()).toBe(true)
    clearOnboarded()
    expect(hasOnboarded()).toBe(false)
  })

  it('is idempotent', () => {
    stubStorage()
    markOnboarded()
    markOnboarded()
    expect(hasOnboarded()).toBe(true)
    expect(backing!.get(ONBOARDING_KEY)).toBe('1')
  })

  it('treats values other than "1" as not onboarded', () => {
    stubStorage()
    localStorage.setItem(ONBOARDING_KEY, 'yes')
    expect(hasOnboarded()).toBe(false)
  })

  it('degrades gracefully without localStorage', () => {
    // No stub: node env has no global localStorage.
    expect(() => hasOnboarded()).not.toThrow()
    expect(() => markOnboarded()).not.toThrow()
    expect(() => clearOnboarded()).not.toThrow()
    expect(hasOnboarded()).toBe(false)
  })

  it('swallows storage failures instead of crashing boot/mutations', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(hasOnboarded()).toBe(false)
    expect(() => markOnboarded()).not.toThrow()
  })
})
