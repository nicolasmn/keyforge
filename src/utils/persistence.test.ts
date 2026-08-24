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
  PREFS_KEY,
  serializePrefs,
  deserializePrefs,
  loadPrefs,
  savePrefs,
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
      collapsed: false,
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

describe('collapse field normalization (optional, no version bump)', () => {
  it('loads a legacy payload without collapsed — treated as expanded', () => {
    // Clone and strip the collapsed key: simulates a pre-collapse save.
    const legacy = JSON.parse(JSON.stringify(validDoc))
    delete legacy.layers[0].collapsed
    expect(legacy.layers[0]).not.toHaveProperty('collapsed')
    const restored = validatePersisted({ version: 1, savedAt: 1, doc: legacy })
    expect(restored).not.toBeNull()
    expect(restored!.layers[0].collapsed).toBe(false)
  })

  it('normalizes non-boolean garbage to false instead of rejecting', () => {
    for (const garbage of ['"yes"', '1', 'null', '"true"', '{}']) {
      const payload = JSON.parse(JSON.stringify(validDoc))
      payload.layers[0].collapsed = JSON.parse(garbage)
      const restored = validatePersisted({ version: 1, savedAt: 1, doc: payload })
      expect(restored, `garbage=${garbage}`).not.toBeNull()
      expect(restored!.layers[0].collapsed, `garbage=${garbage}`).toBe(false)
    }
  })

  it('preserves a real boolean through validation', () => {
    const flagged = JSON.parse(JSON.stringify(validDoc))
    flagged.layers[0].collapsed = true
    const restored = validatePersisted({ version: 1, savedAt: 1, doc: flagged })
    expect(restored!.layers[0].collapsed).toBe(true)
  })

  it('round-trips serialize → deserialize preserving collapsed: true', () => {
    const flagged: AnimationDocument = {
      ...validDoc,
      layers: [{ ...validDoc.layers[0], collapsed: true }],
    }
    const restored = deserializeDoc(serializeDoc(flagged))
    expect(restored).toEqual(flagged)
    expect(restored!.layers[0].collapsed).toBe(true)
  })

  it('still rejects wrong-version payloads (no accidental v2 acceptance)', () => {
    expect(deserializeDoc(JSON.stringify({ version: 2, doc: validDoc }))).toBeNull()
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

describe('prefs (keyforge:prefs:v1)', () => {
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

  it('uses the keyforge:prefs:v1 key', () => {
    expect(PREFS_KEY).toBe('keyforge:prefs:v1')
  })

  it('returns null for null/empty/garbage input', () => {
    expect(deserializePrefs(null)).toBeNull()
    expect(deserializePrefs('')).toBeNull()
    expect(deserializePrefs('not json{')).toBeNull()
    expect(deserializePrefs('42')).toBeNull()
  })

  it('returns null for wrong version or non-object payloads', () => {
    expect(deserializePrefs(JSON.stringify({ version: 2, snapIncrement: 'off' }))).toBeNull()
    expect(deserializePrefs(JSON.stringify({ snapIncrement: 'off' }))).toBeNull()
    expect(deserializePrefs(JSON.stringify([]))).toBeNull()
  })

  it("coerces unknown snapIncrement values to 'off'", () => {
    const raw = JSON.stringify({ version: 1, snapIncrement: 42 })
    const prefs = deserializePrefs(raw)
    expect(prefs).toEqual({ version: 1, snapIncrement: 'off' })
  })

  it("accepts every valid snap value including 'off'", () => {
    for (const v of ['off', 1, 10, 100, 500, 1000] as const) {
      const raw = JSON.stringify({ version: 1, snapIncrement: v })
      expect(deserializePrefs(raw)).toEqual({ version: 1, snapIncrement: v })
    }
  })

  it('round-trips serialize → deserialize preserving value', () => {
    for (const v of ['off', 1, 10, 100, 500, 1000] as const) {
      const payload = serializePrefs({ version: 1, snapIncrement: v })
      expect(deserializePrefs(payload)).toEqual({ version: 1, snapIncrement: v })
    }
  })

  it('stamps version 1 in serialized output', () => {
    const parsed = JSON.parse(serializePrefs({ version: 1, snapIncrement: 100 }))
    expect(parsed.version).toBe(1)
    expect(parsed.snapIncrement).toBe(100)
  })

  it('loadPrefs/savePrefs round-trip through localStorage', () => {
    stubStorage()
    expect(loadPrefs()).toBeNull() // nothing stored yet
    savePrefs({ version: 1, snapIncrement: 500 })
    expect(loadPrefs()).toEqual({ version: 1, snapIncrement: 500 })
    expect(backing!.get(PREFS_KEY)).toBeTypeOf('string')
  })

  it('loadPrefs/savePrefs degrade gracefully without localStorage', () => {
    // No stub: node env has no global localStorage.
    expect(() => loadPrefs()).not.toThrow()
    expect(() => savePrefs({ version: 1, snapIncrement: 100 })).not.toThrow()
    expect(loadPrefs()).toBeNull()
  })

  it('loadPrefs/savePrefs swallow throwing localStorage', () => {
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
    expect(loadPrefs()).toBeNull()
    expect(() => savePrefs({ version: 1, snapIncrement: 10 })).not.toThrow()
  })

  it('corrupt stored JSON yields null rather than crashing boot', () => {
    stubStorage()
    backing!.set(PREFS_KEY, '{{{')
    expect(loadPrefs()).toBeNull()
  })
})
