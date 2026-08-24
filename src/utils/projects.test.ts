import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  PROJECTS_INDEX_KEY,
  SAMPLE_PROJECT_NAME,
  DEFAULT_PROJECT_NAME,
  projectKey,
  validateIndex,
  sortByRecency,
  uniqueName,
  formatRelativeTime,
  localStorageProjectsPort,
  migrateAndReadIndex,
  cloneDocWithFreshIds,
  type ProjectIndex,
} from './projects'
import { serializeDoc, STORAGE_KEY as LEGACY_DOC_KEY } from './persistence'
import type { AnimationDocument } from '@/types'

// ── Fixtures ──────────────────────────────────────────────────────────

const validDoc: AnimationDocument = {
  id: 'D1',
  name: 'My doc',
  duration: 1500,
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

const sampleIndex: ProjectIndex = {
  version: 1,
  projects: [
    { id: 'p1', name: 'Untitled', createdAt: 1000, updatedAt: 3000 },
    { id: 'p2', name: 'Sample animation', createdAt: 1000, updatedAt: 2000 },
  ],
  activeId: 'p1',
}

// Node's test env has no localStorage — stub a minimal Map-backed Storage so
// the real read/write logic is exercised (pattern from persistence.test.ts).
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

describe('schema & keys', () => {
  it('uses stable storage key names', () => {
    expect(PROJECTS_INDEX_KEY).toBe('keyforge:projects:index:v1')
    expect(projectKey('abc')).toBe('keyforge:project:abc:v1')
    expect(LEGACY_DOC_KEY).toBe('keyforge:doc:v1') // legacy autosave address
  })

  it('round-trips an index through writeIndex/readIndex', () => {
    stubStorage()
    localStorageProjectsPort.writeIndex(sampleIndex)
    expect(localStorageProjectsPort.readIndex()).toEqual(sampleIndex)
    expect(JSON.parse(backing!.get(PROJECTS_INDEX_KEY)!).version).toBe(1)
  })

  it('readIndex returns null when absent', () => {
    stubStorage()
    expect(localStorageProjectsPort.readIndex()).toBeNull()
  })

  it('validateIndex rejects malformed payloads', () => {
    const cases = [
      null,
      'nope',
      42,
      {},
      { version: 2, projects: [], activeId: 'x' },
      { projects: sampleIndex.projects, activeId: 'p1' }, // no version
      { ...sampleIndex, activeId: 'ghost' }, // dangling activeId
      {
        ...sampleIndex,
        projects: [...sampleIndex.projects, sampleIndex.projects[0]], // dup ids
      },
      { ...sampleIndex, projects: [{ ...sampleIndex.projects[0], name: 5 }] },
      { ...sampleIndex, projects: [{ ...sampleIndex.projects[0], updatedAt: 'soon' }] },
      { ...sampleIndex, projects: [{ ...sampleIndex.projects[0], createdAt: Number.NaN }] },
      { ...sampleIndex, projects: [] }, // empty can't contain activeId
    ]
    for (const c of cases) {
      expect(validateIndex(c), JSON.stringify(c)?.slice(0, 60)).toBeNull()
    }
    expect(validateIndex(sampleIndex)).toEqual(sampleIndex)
  })
})

describe('per-project docs', () => {
  it('reuses the PersistedDoc payload losslessly', () => {
    stubStorage()
    localStorageProjectsPort.writeDoc('p1', validDoc)
    expect(localStorageProjectsPort.readDoc('p1')).toEqual(validDoc)
    // The stored payload is exactly what serializeDoc produces (parsed —
    // savedAt is stamped at write time, so raw bytes may differ by ms).
    const stored = JSON.parse(backing!.get(projectKey('p1'))!)
    const expected = JSON.parse(serializeDoc(validDoc))
    // savedAt is stamped at write time — exclude it or this test flakes when
    // the two serialize calls straddle a millisecond boundary.
    delete (stored as { savedAt?: number }).savedAt
    delete (expected as { savedAt?: number }).savedAt
    expect(stored).toEqual(expected)
  })

  it('returns null for missing/corrupt payloads', () => {
    stubStorage()
    expect(localStorageProjectsPort.readDoc('missing')).toBeNull()
    backing!.set(projectKey('bad'), '{garbage{')
    expect(localStorageProjectsPort.readDoc('bad')).toBeNull()
    backing!.set(projectKey('v2'), JSON.stringify({ version: 2, doc: validDoc }))
    expect(localStorageProjectsPort.readDoc('v2')).toBeNull()
  })

  it('removeDoc deletes only that project key', () => {
    stubStorage()
    localStorageProjectsPort.writeDoc('a', validDoc)
    localStorageProjectsPort.writeDoc('b', validDoc)
    localStorageProjectsPort.removeDoc('a')
    expect(backing!.has(projectKey('a'))).toBe(false)
    expect(backing!.has(projectKey('b'))).toBe(true)
  })
})

describe('migrateAndReadIndex', () => {
  it('no keys at all → seeds Untitled + Sample animation, Untitled active', () => {
    stubStorage()
    const index = migrateAndReadIndex()
    expect(index.version).toBe(1)
    expect(index.projects.map((p) => p.name)).toEqual([DEFAULT_PROJECT_NAME, SAMPLE_PROJECT_NAME])
    expect(index.activeId).toBe(index.projects[0].id) // Untitled
    // Both docs materialized eagerly behind their own keys.
    for (const meta of index.projects) {
      expect(localStorageProjectsPort.readDoc(meta.id)).not.toBeNull()
    }
    expect(backing!.get(PROJECTS_INDEX_KEY)).toBeTruthy()
  })

  it('legacy autosave + no index → migrates as named ACTIVE project, legacy removed', () => {
    stubStorage()
    backing!.set(LEGACY_DOC_KEY, serializeDoc(validDoc))
    const index = migrateAndReadIndex()
    expect(index.projects).toHaveLength(1)
    const meta = index.projects[0]
    expect(meta.name).toBe('My doc') // named after the migrated document
    expect(index.activeId).toBe(meta.id)
    expect(localStorageProjectsPort.readDoc(meta.id)).toEqual(validDoc) // layers intact
    expect(backing!.has(LEGACY_DOC_KEY)).toBe(false)
    expect(backing!.get(PROJECTS_INDEX_KEY)).toBeTruthy()
  })

  it('legacy autosave + index present → ignored, stray legacy key deleted', () => {
    stubStorage()
    localStorageProjectsPort.writeIndex(sampleIndex)
    backing!.set(LEGACY_DOC_KEY, serializeDoc(validDoc))
    const index = migrateAndReadIndex()
    expect(index).toEqual(sampleIndex)
    expect(backing!.has(LEGACY_DOC_KEY)).toBe(false)
  })

  it('corrupt legacy payload → fresh seed, no crash', () => {
    stubStorage()
    backing!.set(LEGACY_DOC_KEY, '{{{ not json')
    const index = migrateAndReadIndex()
    expect(index.projects.map((p) => p.name)).toEqual([DEFAULT_PROJECT_NAME, SAMPLE_PROJECT_NAME])
    expect(index.activeId).toBe(index.projects[0].id)
    expect(backing!.has(LEGACY_DOC_KEY)).toBe(false)
  })

  it('is idempotent — rerunning returns an equivalent index without duplicates', () => {
    stubStorage()
    const first = migrateAndReadIndex()
    const second = migrateAndReadIndex()
    expect(second).toEqual(first)
    expect(second.projects).toHaveLength(2)

    // And a third run with a stray legacy key lying around still ignores it.
    backing!.set(LEGACY_DOC_KEY, serializeDoc(validDoc))
    expect(migrateAndReadIndex()).toEqual(first)
  })
})

describe('uniqueName', () => {
  it('passes through unused names and trims whitespace', () => {
    expect(uniqueName('  Fresh  ', [])).toBe('Fresh')
  })

  it('auto-suffixes exact duplicates (" 2", " 3", …)', () => {
    expect(uniqueName('X', ['X'])).toBe('X 2')
    expect(uniqueName('X', ['X', 'X 2'])).toBe('X 3')
    expect(uniqueName('X', ['X', 'X 2', 'X 3'])).toBe('X 4')
  })

  it('matches case-insensitively ("foo" vs "FOO")', () => {
    expect(uniqueName('foo', ['FOO'])).toBe('foo 2')
    expect(uniqueName('FOO', ['foo', 'FOO 2'])).toBe('FOO 3')
  })

  it('falls back to "Untitled" for blank input', () => {
    expect(uniqueName('', [])).toBe('Untitled')
    expect(uniqueName('   ', ['Untitled'])).toBe('Untitled 2')
  })
})

describe('quota / blocked storage', () => {
  function warnSpy() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {})
  }

  it('setItem throwing → no throw upward; reads stay consistent', () => {
    stubStorage()
    const warn = warnSpy()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (backing as Map<string, string>).get(k) ?? null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: (k: string) => void (backing as Map<string, string>).delete(k),
    })
    expect(() => localStorageProjectsPort.writeIndex(sampleIndex)).not.toThrow()
    expect(() => localStorageProjectsPort.writeDoc('p1', validDoc)).not.toThrow()
    // Writes failed → reads treat state as absent rather than lying.
    expect(localStorageProjectsPort.readIndex()).toBeNull()
    expect(localStorageProjectsPort.readDoc('p1')).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('getItem throwing → treated as absent (migration still boots)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {},
      removeItem: () => {},
    })
    warnSpy()
    let index: ProjectIndex | null = null
    expect(() => {
      index = migrateAndReadIndex()
    }).not.toThrow()
    expect(index!.projects.map((p) => p.name)).toEqual([DEFAULT_PROJECT_NAME, SAMPLE_PROJECT_NAME])
  })

  it('removeItem throwing is swallowed', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(() => localStorageProjectsPort.removeDoc('x')).not.toThrow()
  })
})

describe('ordering & helpers', () => {
  it('sortByRecency orders by updatedAt desc', () => {
    const sorted = sortByRecency([
      { id: 'old', name: 'old', createdAt: 0, updatedAt: 10 },
      { id: 'new', name: 'new', createdAt: 0, updatedAt: 30 },
      { id: 'mid', name: 'mid', createdAt: 0, updatedAt: 20 },
    ])
    expect(sorted.map((p) => p.id)).toEqual(['new', 'mid', 'old'])
  })

  it('formatRelativeTime buckets sensibly', () => {
    const now = Date.parse('2026-08-24T12:00:00Z')
    expect(formatRelativeTime(now - 3_000, now)).toBe('just now')
    expect(formatRelativeTime(now - 30_000, now)).toBe('30s ago')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe('2h ago')
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe('3d ago')
    expect(formatRelativeTime(now - 30 * 86_400_000, now)).toMatch(/\d/) // date fallback
  })

  it('cloneDocWithFreshIds regenerates every id but preserves content', () => {
    const copy = cloneDocWithFreshIds(validDoc)
    expect(copy.id).not.toBe(validDoc.id)
    expect(copy.layers[0].id).not.toBe(validDoc.layers[0].id)
    expect(copy.layers[0].tracks[0].id).not.toBe(validDoc.layers[0].tracks[0].id)
    expect(copy.layers[0].tracks[0].keyframes[0].id).not.toBe(
      validDoc.layers[0].tracks[0].keyframes[0].id,
    )
    // Restore the regenerated ids and everything else must match exactly.
    copy.id = validDoc.id
    copy.layers[0].id = validDoc.layers[0].id
    copy.layers[0].tracks[0].id = validDoc.layers[0].tracks[0].id
    copy.layers[0].tracks[0].keyframes[0].id = validDoc.layers[0].tracks[0].keyframes[0].id
    expect(copy).toEqual(validDoc)

    // Fresh copies regenerate every id — all unique within one clone.
    const fresh = cloneDocWithFreshIds(validDoc)
    const ids = [
      fresh.id,
      ...fresh.layers.flatMap((l) => [
        l.id,
        ...l.tracks.flatMap((t) => [t.id, ...t.keyframes.map((k) => k.id)]),
      ]),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('cloneDocWithFreshIds — origin aliasing', () => {
  it('deep-copies the nested origin point (no shared reference)', async () => {
    const { cloneDocWithFreshIds } = await import('./projects')
    const doc = {
      id: 'd1',
      name: 't',
      duration: 1000,
      layers: [
        {
          id: 'L1',
          name: 'a',
          visible: true,
          collapsed: false,
          element: { tag: 'div', initialCss: '', origin: { x: '0%', y: '100%' } },
          tracks: [],
        },
      ],
    } as never
    const clone = cloneDocWithFreshIds(doc)
    const srcEl = (doc as { layers: { element: { origin: { x: string } } }[] }).layers[0].element
    const clEl = clone.layers[0].element as { origin: { x: string } }
    expect(clEl).not.toBe(srcEl)
    expect(clEl.origin).not.toBe(srcEl.origin)
    expect(clEl.origin).toEqual(srcEl.origin)
    // Mutation through the clone must NOT reach the source.
    clEl.origin.x = '50%'
    expect(srcEl.origin.x).toBe('0%')
  })
})
