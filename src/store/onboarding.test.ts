import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AnimationDocument } from '@/types'
import type * as PersistenceModule from '@/utils/persistence'
import { serializeDoc, STORAGE_KEY as LEGACY_DOC_KEY } from '@/utils/persistence'
import { nanoid } from '@/utils/nanoid'

/**
 * First-run seeding + onboarding flag behavior (audit F21).
 *
 * The store reads persistence at module init, so each test boots a fresh
 * copy of '@/store' with mocked persistence functions. Since projects
 * landed, boot restores via the projects registry: a legacy single-key
 * autosave (`keyforge:doc:v1`) migrates into a named active project.
 */

const mocks = vi.hoisted(() => ({
  loadFromStorage: vi.fn<() => unknown>(() => null),
}))

vi.mock('@/utils/persistence', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof PersistenceModule
  return {
    ...actual,
    loadFromStorage: mocks.loadFromStorage as () => AnimationDocument | null,
    // Backed by plain module state so tests can arrange "already onboarded"
    // and assert when the store flips the flag.
    hasOnboarded: vi.fn(() => state.flagged),
    markOnboarded: vi.fn(() => {
      state.flagged = true
    }),
  }
})

const state = { flagged: false }

/** A saved document with one layer, as autosave would produce. */
function savedDoc(): AnimationDocument {
  return {
    id: nanoid(),
    name: 'My doc',
    duration: 1500,
    layers: [
      {
        id: nanoid(),
        name: 'Box',
        visible: true,
        element: { tag: 'div', text: '', initialCss: '' },
        tracks: [],
      },
    ],
  }
}

/** Map-backed localStorage stub so migration/seed logic really runs. */
function stubStorage(): Map<string, string> {
  const backing = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  })
  return backing
}

async function bootStore() {
  return import('@/store')
}

async function persistenceMocks() {
  const mod = await import('@/utils/persistence')
  return { markOnboarded: mod.markOnboarded as ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  state.flagged = false
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('first-run seeding', () => {
  it('true first run seeds a 0-layer document so the EmptyState fires', async () => {
    stubStorage()
    const { doc, onboarded } = await bootStore()
    expect(doc.layers).toHaveLength(0)
    expect(doc.name).toBe('Untitled')
    expect(doc.duration).toBe(2000)
    expect(onboarded()).toBe(false)
  })

  it('true first run also registers the built-in sample project (active stays Untitled)', async () => {
    stubStorage()
    const { doc, listProjects, activeProjectId } = await bootStore()
    const names = listProjects().map((p) => p.name)
    expect(names).toEqual(['Untitled', 'Sample animation'])
    expect(activeProjectId()).toBe(listProjects()[0].id)
    expect(doc.name).toBe('Untitled')
    expect(doc.layers).toHaveLength(0)
  })

  it('restores a legacy autosave as a named ACTIVE project with layers intact', async () => {
    const backing = stubStorage()
    backing.set(LEGACY_DOC_KEY, serializeDoc(savedDoc()))
    const { doc, listProjects, activeProjectId } = await bootStore()
    expect(listProjects()).toHaveLength(1)
    expect(listProjects()[0].name).toBe('My doc')
    expect(doc.layers).toHaveLength(1)
    expect(activeProjectId()).toBe(listProjects()[0].id)
    // One-time migration consumed the legacy key.
    expect(backing.has(LEGACY_DOC_KEY)).toBe(false)
  })

  it('migration leaves the onboarded flag alone at boot', async () => {
    const { markOnboarded } = await persistenceMocks()
    const backing = stubStorage()
    backing.set(LEGACY_DOC_KEY, serializeDoc(savedDoc()))
    await bootStore()
    expect(markOnboarded).not.toHaveBeenCalled()
    expect(state.flagged).toBe(false)
  })

  it('boots empty even when already onboarded but nothing was autosaved', async () => {
    stubStorage()
    state.flagged = true
    const { doc, onboarded } = await bootStore()
    expect(doc.layers).toHaveLength(0)
    expect(onboarded()).toBe(true)
  })
})

describe('addStarterLayer', () => {
  it('creates the pre-built Box layer ("Add your first layer")', async () => {
    const { doc, addStarterLayer } = await bootStore()
    addStarterLayer()
    expect(doc.layers).toHaveLength(1)
    const layer = doc.layers[0]
    expect(layer.name).toBe('Box')
    expect(layer.tracks.map((t) => t.property)).toEqual(['opacity', 'transform'])
    expect(layer.tracks[0].keyframes.map((k) => k.value)).toEqual(['0', '1'])
    expect(layer.tracks[1].keyframes.map((k) => k.value)).toEqual([
      'translateY(40px)',
      'translateY(0px)',
    ])
  })

  it('selects the starter layer', async () => {
    const { doc, addStarterLayer, selectedLayerId } = await bootStore()
    addStarterLayer()
    expect(selectedLayerId()).toBe(doc.layers[0].id)
  })

  it('marks onboarding (content now exists)', async () => {
    const { addStarterLayer } = await bootStore()
    const { markOnboarded } = await persistenceMocks()
    addStarterLayer()
    expect(markOnboarded).toHaveBeenCalled()
    expect(state.flagged).toBe(true)
  })
})

describe('onboarding flag is set once content exists', () => {
  it('addLayer marks onboarding', async () => {
    const { addLayer } = await bootStore()
    const { markOnboarded } = await persistenceMocks()
    addLayer()
    expect(markOnboarded).toHaveBeenCalledTimes(1)
  })

  it('replaceDoc marks onboarding (import / sample load)', async () => {
    const { replaceDoc } = await bootStore()
    const { markOnboarded } = await persistenceMocks()
    replaceDoc(savedDoc())
    expect(markOnboarded).toHaveBeenCalledTimes(1)
  })

  it('duration-only changes do NOT mark onboarding', async () => {
    const { setDuration } = await bootStore()
    const { markOnboarded } = await persistenceMocks()
    setDuration(3000)
    expect(markOnboarded).not.toHaveBeenCalled()
  })

  it('stays marked after the user deliberately empties the doc (no re-nag)', async () => {
    const { doc, onboarded, addLayer, removeLayer } = await bootStore()
    const { markOnboarded } = await persistenceMocks()
    addLayer()
    removeLayer(doc.layers[0].id)
    expect(doc.layers).toHaveLength(0)
    expect(onboarded()).toBe(true)
    // Only the first content-creating mutation marks the flag.
    expect(markOnboarded).toHaveBeenCalledTimes(1)
  })
})
