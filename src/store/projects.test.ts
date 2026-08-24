import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AnimationDocument } from '@/types'
import { serializeDoc, STORAGE_KEY as LEGACY_DOC_KEY } from '@/utils/persistence'
import { PROJECTS_INDEX_KEY } from '@/utils/projects'
import { nanoid } from '@/utils/nanoid'
import type * as PersistenceModule from '@/utils/persistence'

/**
 * Projects store integration: boot seeding/migration, autosave targeting,
 * open/create/rename/delete/duplicate flows. Uses the REAL projects port
 * backed by a Map-stubbed localStorage (vi.stubGlobal pattern from
 * persistence.test.ts), so index/doc key names and migration semantics are
 * exercised end-to-end. The onboarding flag functions are mocked to plain
 * module state so tests can arrange and count flag flips.
 */

const state = { flagged: false }

vi.mock('@/utils/persistence', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof PersistenceModule
  return {
    ...actual,
    hasOnboarded: vi.fn(() => state.flagged),
    markOnboarded: vi.fn(() => {
      state.flagged = true
    }),
  }
})

const INDEX_KEY = PROJECTS_INDEX_KEY
const pkey = (id: string) => `keyforge:project:${id}:v1`

let backing: Map<string, string>

function savedDoc(name = 'My doc'): AnimationDocument {
  return {
    id: nanoid(),
    name,
    duration: 1500,
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
            keyframes: [{ id: nanoid(), time: 0, value: '0', easing: 'linear' }],
          },
        ],
      },
    ],
  }
}

async function bootStore() {
  return import('@/store')
}

function storedIndex(): {
  activeId: string
  projects: { id: string; name: string; updatedAt: number }[]
} {
  return JSON.parse(backing.get(INDEX_KEY)!)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  state.flagged = false
  backing = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('boot', () => {
  it('true first run: two seeded projects, Untitled active, empty doc, flag unset', async () => {
    const s = await bootStore()
    const projects = s.listProjects()
    expect(projects.map((p) => p.name)).toEqual(['Untitled', 'Sample animation'])
    expect(s.activeProjectId()).toBe(projects[0].id)
    expect(s.doc.layers).toHaveLength(0)
    expect(s.onboarded()).toBe(false)
    expect(backing.has(INDEX_KEY)).toBe(true)
  })

  it('legacy autosave boots back as a named active project; legacy key removed; flag untouched', async () => {
    const { markOnboarded } = await import('@/utils/persistence')
    backing.set(LEGACY_DOC_KEY, serializeDoc(savedDoc()))
    const s = await bootStore()
    expect(s.listProjects()).toHaveLength(1)
    expect(s.listProjects()[0].name).toBe('My doc')
    expect(s.doc.layers).toHaveLength(1)
    expect(s.activeProjectId()).toBe(s.listProjects()[0].id)
    expect(backing.has(LEGACY_DOC_KEY)).toBe(false)
    expect(markOnboarded).not.toHaveBeenCalled()
  })
})

describe('autosave', () => {
  it('targets only the active project key and bumps its updatedAt', async () => {
    const s = await bootStore()
    const [untitled, sample] = s.listProjects()
    const sampleKeyBefore = backing.get(pkey(sample.id))
    // Boot seeds docs eagerly (write-ahead), so capture the baseline instead
    // of asserting absence — the invariant is "no autosave write yet".
    const untitledKeyBefore = backing.get(pkey(untitled.id))

    s.addLayer() // schedules a debounced save
    // Nothing persisted before the debounce elapses.
    expect(backing.get(pkey(untitled.id))).toBe(untitledKeyBefore)

    vi.advanceTimersByTime(300)
    const payload = JSON.parse(backing.get(pkey(untitled.id))!)
    expect(payload.doc.layers).toHaveLength(1)
    // The other project's bytes are untouched.
    expect(backing.get(pkey(sample.id))).toBe(sampleKeyBefore)

    // Index recency bumped + still most-recent-first, and activeId preserved.
    const idx = storedIndex()
    const untitledMeta = idx.projects.find((p) => p.id === untitled.id)!
    expect(idx.projects[0].id).toBe(untitled.id)
    expect(untitledMeta.updatedAt).toBeGreaterThan(sample.updatedAt)
    expect(idx.activeId).toBe(untitled.id)
  })

  it('replaceDoc lands in the ACTIVE project key immediately (no debounce wait)', async () => {
    const s = await bootStore()
    const [untitled] = s.listProjects()
    s.replaceDoc(savedDoc('Imported'))
    const payload = JSON.parse(backing.get(pkey(untitled.id))!)
    expect(payload.doc.name).toBe('Imported')
    expect(storedIndex().activeId).toBe(untitled.id)
  })
})

describe('openProject', () => {
  it('flush-saves the outgoing project, swaps doc, resets transient state, updates index', async () => {
    const s = await bootStore()
    const [untitled, sample] = s.listProjects()

    s.addLayer() // pending (debounced) save for Untitled
    expect(s.openProject(sample.id)).toBe(true)

    // Outgoing project was flushed despite the cancelled timer.
    expect(JSON.parse(backing.get(pkey(untitled.id))!).doc.layers).toHaveLength(1)

    expect(s.doc.name).toBe('Sample animation')
    expect(s.doc.layers.length).toBe(2)
    expect(s.selectedLayerId()).toBe(s.doc.layers[0].id)
    expect(s.selectedKeyframeId()).toBeNull()
    expect(s.playhead()).toBe(0)
    expect(s.playing()).toBe(false)
    expect(s.activeProjectId()).toBe(sample.id)
    expect(storedIndex().activeId).toBe(sample.id)
  })

  it('keeps the current doc on a missing or corrupt target (no data loss)', async () => {
    const s = await bootStore()
    const [, sample] = s.listProjects()
    backing.set(pkey(sample.id), '{corrupt')

    expect(s.openProject(sample.id)).toBe(false)
    expect(s.doc.name).toBe('Untitled')
    expect(s.activeProjectId()).toBe(s.listProjects()[0].id)
    expect(s.openProject('ghost-id')).toBe(false)
    expect(s.doc.name).toBe('Untitled')
  })

  it('opening the populated Sample marks onboarding; returning to empty Untitled stays quiet', async () => {
    const s = await bootStore()
    const [untitled, sample] = s.listProjects()
    expect(s.openProject(sample.id)).toBe(true)
    expect(s.doc.layers.length).toBeGreaterThan(0) // sample carries real content
    expect(s.onboarded()).toBe(true)
    // Back to the still-empty first project — flag persists, no re-nag.
    expect(s.openProject(untitled.id)).toBe(true)
    expect(s.doc.layers).toHaveLength(0)
    expect(s.onboarded()).toBe(true)
  })

  it('opening an EMPTY project pre-onboarding keeps the guided EmptyState visible', async () => {
    const s = await bootStore()
    const [untitled] = s.listProjects()
    // Untitled IS the active empty project; re-opening it changes nothing.
    expect(s.openProject(untitled.id)).toBe(true)
    expect(s.doc.layers).toHaveLength(0)
    expect(s.onboarded()).toBe(false)
  })
})

describe('createProject / createProjectWithDoc', () => {
  it('creates + opens a fresh empty project with unique name', async () => {
    const s = await bootStore()
    const id = s.createProject('Untitled') // collides with seeded Untitled
    expect(s.doc.name).toBe('Untitled 2')
    expect(s.doc.layers).toHaveLength(0)
    expect(s.activeProjectId()).toBe(id)
    expect(s.listProjects().map((p) => p.name)).toEqual([
      'Untitled 2',
      'Untitled',
      'Sample animation',
    ])
    expect(storedIndex().activeId).toBe(id)
    expect(backing.has(pkey(id))).toBe(true)
  })

  it('flushes the outgoing project before switching away', async () => {
    const s = await bootStore()
    const [untitled] = s.listProjects()
    s.addLayer()
    s.createProject('Second')
    // Untitled's pending save must not have been lost by the switch.
    expect(JSON.parse(backing.get(pkey(untitled.id))!).doc.layers).toHaveLength(1)
  })

  it('createProjectWithDoc registers a preset (sample re-registration path)', async () => {
    const s = await bootStore()
    const id = s.createProjectWithDoc('Sample animation', () => ({
      id: nanoid(),
      name: 'Sample animation',
      duration: 2000,
      layers: [savedDoc().layers[0]],
    }))
    expect(s.doc.name).toBe('Sample animation 2') // seeded sample owns the bare name
    expect(s.activeProjectId()).toBe(id)
  })
})

describe('renameProject', () => {
  it('updates index + live doc for the ACTIVE project', async () => {
    const s = await bootStore()
    const [untitled] = s.listProjects()
    s.renameProject(untitled.id, 'Renamed')
    expect(s.doc.name).toBe('Renamed')
    expect(storedIndex().projects.find((p) => p.id === untitled.id)!.name).toBe('Renamed')
  })

  it('does not touch the live doc when renaming a NON-active project', async () => {
    const s = await bootStore()
    const [, sample] = s.listProjects()
    s.renameProject(sample.id, 'Demo')
    expect(s.doc.name).toBe('Untitled') // active unchanged
    expect(storedIndex().projects.find((p) => p.id === sample.id)!.name).toBe('Demo')
  })

  it('dedupes case-insensitively against other projects (self-rename is a no-op)', async () => {
    const s = await bootStore()
    const [, sample] = s.listProjects()
    expect(s.renameProject(sample.id, 'UNTITLED')).toBe('UNTITLED 2')
    const [untitled] = s.listProjects()
    expect(s.renameProject(untitled.id, 'untitled')).toBe('untitled') // own name ok
  })

  it('blank rename falls back to "Untitled" (with suffix if taken)', async () => {
    const s = await bootStore()
    const [, sample] = s.listProjects()
    expect(s.renameProject(sample.id, '   ')).toBe('Untitled 2')
  })
})

describe('deleteProject', () => {
  it('deleting a non-active project removes meta + per-project key only', async () => {
    const s = await bootStore()
    const [, sample] = s.listProjects()
    s.deleteProject(sample.id)
    expect(s.listProjects().map((p) => p.name)).toEqual(['Untitled'])
    expect(backing.has(pkey(sample.id))).toBe(false)
    expect(s.activeProjectId()).toBe(s.listProjects()[0].id)
    expect(storedIndex().activeId).toBe(s.activeProjectId())
  })

  it('deleting the ACTIVE project falls over to the next most-recent project', async () => {
    const s = await bootStore()
    const secondId = s.createProject('Second') // becomes active + most recent
    s.addLayer() // give Second content so we can prove the swap
    vi.advanceTimersByTime(300)

    s.deleteProject(secondId)
    const [remaining] = s.listProjects()
    expect(remaining.name).toBe('Untitled')
    expect(s.activeProjectId()).toBe(remaining.id)
    expect(s.doc.name).toBe('Untitled')
    expect(backing.has(pkey(secondId))).toBe(false)
    expect(storedIndex().activeId).toBe(remaining.id)
  })

  it('deleting the LAST project auto-creates Untitled (app never doc-less)', async () => {
    const s = await bootStore()
    const [untitled, sample] = s.listProjects()
    s.deleteProject(untitled.id) // fall over to Sample
    expect(s.doc.name).toBe('Sample animation')
    s.deleteProject(sample.id) // last one → fresh Untitled
    const after = s.listProjects()
    expect(after).toHaveLength(1)
    expect(after[0].name).toBe('Untitled')
    expect(s.doc.name).toBe('Untitled')
    expect(s.doc.layers).toHaveLength(0)
    expect(s.activeProjectId()).toBe(after[0].id)
  })

  it('a late debounced autosave never resurrects the deleted project key', async () => {
    const s = await bootStore()
    const [untitled, sample] = s.listProjects()
    s.openProject(sample.id)
    s.addLayer() // pending save for Sample…
    s.deleteProject(sample.id) // …cancelled by delete
    vi.advanceTimersByTime(1000)
    expect(backing.has(pkey(sample.id))).toBe(false)
    // And the surviving project was not clobbered either.
    expect(backing.has(pkey(untitled.id))).toBe(true)
  })

  it('fall-over skips unreadable projects and lands on the most recent readable one', async () => {
    const s = await bootStore()
    const [, sample] = s.listProjects()
    // Corrupt Sample's stored bytes while a DIFFERENT project is active
    // (the active project's own key is always rewritten from memory).
    backing.set(pkey(sample.id), '{broken')
    const goodId = s.createProject('Good')

    s.deleteProject(goodId)
    const [remaining] = s.listProjects()
    expect(remaining.name).toBe('Untitled') // skipped corrupt Sample
    expect(s.activeProjectId()).toBe(remaining.id)
    expect(s.doc.name).toBe('Untitled')
    // The unreadable meta stays listed for manual cleanup (UI greys it out).
    expect(s.listProjects().map((p) => p.name)).toEqual(['Untitled', 'Sample animation'])
  })
})

describe('duplicateProject', () => {
  it('copies with fresh ids under "<name> copy" and opens the copy', async () => {
    const s = await bootStore()
    const [, sample] = s.listProjects()
    const dupId = s.duplicateProject(sample.id)
    expect(dupId).not.toBeNull()
    expect(s.doc.name).toBe('Sample animation copy')
    expect(s.activeProjectId()).toBe(dupId)

    const orig = JSON.parse(backing.get(pkey(sample.id))!)
    const copy = JSON.parse(backing.get(pkey(dupId!))!)
    expect(copy.doc.layers).toHaveLength(orig.doc.layers.length)
    const origIds = [
      orig.doc.id,
      ...orig.doc.layers.flatMap((l: AnimationDocument['layers'][number]) => [
        l.id,
        ...l.tracks.flatMap((t) => [t.id, ...t.keyframes.map((k) => k.id)]),
      ]),
    ]
    const copyIds = [
      copy.doc.id,
      ...copy.doc.layers.flatMap((l: AnimationDocument['layers'][number]) => [
        l.id,
        ...l.tracks.flatMap((t) => [t.id, ...t.keyframes.map((k) => k.id)]),
      ]),
    ]
    for (const id of copyIds) expect(origIds).not.toContain(id)
  })

  it('returns null for unknown sources', async () => {
    const s = await bootStore()
    expect(s.duplicateProject('ghost')).toBeNull()
  })
})

describe('onboarding interplay', () => {
  it('opening the built-in sample marks onboarding exactly once; duration-only changes do not re-mark', async () => {
    const { markOnboarded } = await import('@/utils/persistence')
    const s = await bootStore()
    const sample = s.listProjects().find((p) => p.name === 'Sample animation')!
    s.openProject(sample.id)
    expect(state.flagged).toBe(true)
    expect(markOnboarded).toHaveBeenCalledTimes(1)

    s.setDuration(3000)
    vi.advanceTimersByTime(300)
    expect(markOnboarded).toHaveBeenCalledTimes(1)
  })

  it('creating an empty project does NOT mark onboarding', async () => {
    const { markOnboarded } = await import('@/utils/persistence')
    const s = await bootStore()
    s.createProject('Blank')
    expect(markOnboarded).not.toHaveBeenCalled()
    expect(state.flagged).toBe(false)
  })
})
