import { describe, it, expect, vi } from 'vitest'
import type { AnimationDocument, Layer } from '@/types'
import type * as PersistenceModule from '@/utils/persistence'
import { generateCss } from './css'
import {
  buildEditableSnapshot,
  clampPlayhead,
  commitEditedCss,
  preserveSelectionByName,
  snapshotExclusionReason,
  unrepresentableLayers,
} from './cssEdit'

// ── Fixtures ───────────────────────────────────────────────────────────

function boxLayer(): Layer {
  return {
    id: 'layer-box',
    name: 'Box',
    visible: true,
    element: { tag: 'section', text: 'Hi', initialCss: 'background-color:red;border-radius:12px;' },
    tracks: [
      {
        id: 'track-box-opacity',
        property: 'opacity',
        keyframes: [
          { id: 'kf-box-op-0', time: 0, value: '0', easing: 'linear' },
          { id: 'kf-box-op-1', time: 1200, value: '0.8', easing: 'ease-out' },
          { id: 'kf-box-op-2', time: 2400, value: '1', easing: 'linear' },
        ],
      },
    ],
  }
}

function makeDoc(
  overrides?: Partial<Pick<AnimationDocument, 'layers' | 'duration'>>,
): AnimationDocument {
  return {
    id: 'doc-1',
    name: 'My Ad',
    duration: 2400,
    layers: [boxLayer()],
    ...overrides,
  }
}

/** Hidden layer WITH keyframes — the classic R1 data-loss victim. */
function hiddenLayer(): Layer {
  return {
    id: 'layer-dot',
    name: 'Dot',
    visible: false,
    element: { tag: 'div', text: '', initialCss: '' },
    tracks: [
      {
        id: 'track-dot-transform',
        property: 'transform',
        keyframes: [
          { id: 'kf-dot-tf-0', time: 0, value: 'translateY(40px)', easing: 'linear' },
          { id: 'kf-dot-tf-1', time: 2400, value: 'translateY(0px)', easing: 'linear' },
        ],
      },
    ],
  }
}

/** Visible layer with no keyframes yet — also absent from the snapshot. */
function emptyLayer(): Layer {
  return {
    id: 'layer-bar',
    name: 'Bar',
    visible: true,
    element: { tag: 'span', text: 'x', initialCss: 'color:blue;' },
    tracks: [{ id: 'track-bar-width', property: 'width', keyframes: [] }],
  }
}

/** Same comparator contract as roundtrip.test.ts (ids ignored). */
function docShape(d: AnimationDocument) {
  return {
    duration: d.duration,
    layers: d.layers.map((l) => ({
      name: l.name.toLowerCase(),
      visible: l.visible,
      element: l.element,
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

// ── buildEditableSnapshot ──────────────────────────────────────────────

describe('buildEditableSnapshot', () => {
  it('is exactly the full-document generated CSS', () => {
    const doc = makeDoc()
    expect(buildEditableSnapshot(doc)).toBe(generateCss(doc))
  })

  it('documents the R1 root cause: hidden and keyframe-less layers are excluded', () => {
    const doc = makeDoc({ layers: [boxLayer(), hiddenLayer(), emptyLayer()] })
    const css = buildEditableSnapshot(doc)
    expect(css).toContain('kf-box')
    // Neither excluded layer contributes text:
    expect(css).not.toContain('kf-dot')
    expect(css).not.toContain('kf-bar')
    expect(unrepresentableLayers(doc).map((l) => l.name)).toEqual(['Dot', 'Bar'])
    expect(snapshotExclusionReason(hiddenLayer())).toBe('hidden')
    expect(snapshotExclusionReason(emptyLayer())).toBe('no-keyframes')
    expect(snapshotExclusionReason(boxLayer())).toBeNull()
  })
})

// ── commitEditedCss — enrichment (R2 trap) ─────────────────────────────

describe('commitEditedCss: preserves document identity and layer metadata (R2)', () => {
  it('keeps the current document name and id instead of "Imported animation"', () => {
    const doc = makeDoc({ duration: 2000 })
    const css = buildEditableSnapshot(doc)
    const result = commitEditedCss(css, doc)
    expect(result.fatal).toBe(false)
    expect(result.nextDoc!.name).toBe('My Ad')
    expect(result.nextDoc!.id).toBe('doc-1')
    expect(result.nextDoc!.name).not.toBe('Imported animation')
  })

  it('restores the authored layer display name (export slugifies "Box" to "box")', () => {
    const doc = makeDoc()
    const css = buildEditableSnapshot(doc)
    expect(css).toContain('kf-box-0') // the text only knows the slug form
    const result = commitEditedCss(css, doc)
    expect(result.nextDoc!.layers.map((l) => l.name)).toContain('Box')
  })

  it('matched layers keep their exact custom element object', () => {
    const doc = makeDoc()
    const result = commitEditedCss(buildEditableSnapshot(doc), doc)
    const nextBox = result.nextDoc!.layers.find((l) => l.name === 'Box')!
    expect(nextBox.element).toEqual({
      tag: 'section',
      text: 'Hi',
      initialCss: 'background-color:red;border-radius:12px;',
    })
    // Not the importer's hardcoded default starter CSS.
    expect(nextBox.element.initialCss).not.toContain('hsl(264')
  })

  it('a genuinely new layer gets importer defaults plus a soft info warning', () => {
    const doc = makeDoc()
    const css = `${buildEditableSnapshot(doc)}\n\n@keyframes kf-slab-0 {\n  0% { opacity: 0; }\n  100% { opacity: 1; }\n}\n\n[data-layer-id="slab"] {\n  animation-name: kf-slab-0;\n  animation-duration: 2400ms;\n  animation-timing-function: linear;\n  animation-fill-mode: both;\n  animation-iteration-count: infinite;\n  animation-play-state: paused;\n}`
    const result = commitEditedCss(css, doc)
    expect(result.fatal).toBe(false)
    const slab = result.nextDoc!.layers.find((l) => l.name.toLowerCase() === 'slab')!
    expect(slab.element.tag).toBe('div')
    expect(result.warnings.some((w) => w.includes('slab'))).toBe(true)
  })
})

// ── commitEditedCss — hidden/keyframe-less rescue (R1 trap) ────────────

describe('commitEditedCss: hidden/keyframe-less layers survive the round-trip (R1)', () => {
  it('committing edited text that omits a hidden layer preserves visibility + keyframes', () => {
    const doc = makeDoc({ layers: [boxLayer(), hiddenLayer()] })
    const css = buildEditableSnapshot(doc) // Dot is absent here by construction
    expect(css).not.toContain('Dot')

    // User edits only Box's opacity stop.
    const edited = css.replace('opacity:0.8;', 'opacity:0.5;')
    const result = commitEditedCss(edited, doc)

    expect(result.fatal).toBe(false)
    const dot = result.nextDoc!.layers.find((l) => l.name === 'Dot')
    expect(dot).toBeDefined()
    expect(dot!.visible).toBe(false)
    // Keyframes survive byte-for-byte in shape (ids may be fresh).
    expect(dot!.tracks[0].property).toBe('transform')
    expect(dot!.tracks[0].keyframes.map((k) => [k.time, k.value, k.easing])).toEqual([
      [0, 'translateY(40px)', 'linear'],
      [2400, 'translateY(0px)', 'linear'],
    ])
    expect(dot!.id).toBe('layer-dot')
    // And a warning tells the user what was preserved.
    expect(
      result.warnings.some((w) => w.includes('"Dot"') && w.toLowerCase().includes('hidden')),
    ).toBe(true)
    // The visible edit landed too.
    const boxOpacity = result.nextDoc!.layers[0].tracks.find((t) => t.property === 'opacity')!
    expect(boxOpacity.keyframes.map((k) => k.value)).toContain('0.5')
  })

  it('committing edited text that omits a keyframe-less layer preserves it unchanged', () => {
    const doc = makeDoc({ layers: [boxLayer(), emptyLayer()] })
    const css = buildEditableSnapshot(doc)
    expect(css).not.toContain('Bar')

    const result = commitEditedCss(css, doc)
    const bar = result.nextDoc!.layers.find((l) => l.name === 'Bar')
    expect(bar).toBeDefined()
    expect(bar!.element.tag).toBe('span')
    expect(bar!.tracks).toHaveLength(1)
    expect(bar!.tracks[0].keyframes).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('Bar'))).toBe(true)
  })

  it('rescued layers keep their original ids so selection can survive untouched', () => {
    const doc = makeDoc({ layers: [boxLayer(), hiddenLayer()] })
    const result = commitEditedCss(buildEditableSnapshot(doc), doc)
    const dot = result.nextDoc!.layers.find((l) => l.name === 'Dot')!
    expect(dot.id).toBe('layer-dot')
  })

  it('deleting a fully-representable layer from the text is still a deliberate deletion', () => {
    const dotOnly = hiddenLayer()
    dotOnly.visible = true
    const doc = makeDoc({ layers: [boxLayer(), dotOnly] })
    const css = buildEditableSnapshot(doc)
    // Remove every Box rule + companion block from the text.
    const withoutBox = css
      .split('\n\n')
      .filter((chunk) => !chunk.includes('kf-box') && !chunk.includes('data-layer-id="box"'))
      .join('\n\n')

    const result = commitEditedCss(withoutBox, doc)
    expect(result.fatal).toBe(false)
    expect(result.nextDoc!.layers.find((l) => l.name === 'Box')).toBeUndefined()
    expect(result.nextDoc!.layers.find((l) => l.name === 'Dot')).toBeDefined()
    // No preservation notice for Box — its deletion was intentional.
    expect(result.warnings.some((w) => w.includes('"Box"'))).toBe(false)
  })
})

// ── commitEditedCss — parse passthrough & duration handling ────────────

describe('commitEditedCss: parse passthrough', () => {
  it('reflects an edited stop value in the committed doc', () => {
    const doc = makeDoc()
    const edited = buildEditableSnapshot(doc).replace('opacity:0.8;', 'opacity:0.5;')
    const result = commitEditedCss(edited, doc)
    const opacity = result.nextDoc!.layers[0].tracks.find((t) => t.property === 'opacity')!
    expect(opacity.keyframes.map((k) => k.value)).toContain('0.5')
  })

  it('honors an explicit new companion duration and rescales times', () => {
    const doc = makeDoc()
    // The exporter writes `animation-duration: 2400ms;` (space after colon).
    const edited = buildEditableSnapshot(doc).replace(
      'animation-duration: 2400ms;',
      'animation-duration: 1200ms;',
    )
    expect(edited).not.toBe(buildEditableSnapshot(doc))
    const result = commitEditedCss(edited, doc)
    expect(result.nextDoc!.duration).toBe(1200)
    const last = result.nextDoc!.layers[0].tracks[0].keyframes.at(-1)!
    expect(last.time).toBe(1200) // was 100% of 2400ms → now 100% of 1200ms
  })

  it('falls back to the CURRENT duration when the user deleted every animation-duration line', () => {
    const doc = makeDoc() // duration 2400 — parser default would be 2000
    const stripped = buildEditableSnapshot(doc)
      .split('\n')
      .filter((line) => !line.includes('animation-duration'))
      .join('\n')
    const result = commitEditedCss(stripped, doc)
    expect(result.fatal).toBe(false)
    expect(result.nextDoc!.duration).toBe(2400)
  })

  it('mid-typing fragments are fatal but never throw', () => {
    const doc = makeDoc()
    for (const fragment of ['', '@keyframes kf-x-0 { 0% { opa', '@keyframes broken {', '   ']) {
      const result = commitEditedCss(fragment, doc)
      expect(result.fatal).toBe(true)
      expect(result.nextDoc).toBeNull()
      expect(result.warnings.length).toBeGreaterThan(0)
    }
  })

  it('soft parser warnings pass through with a valid doc', () => {
    const doc = makeDoc()
    const edited = buildEditableSnapshot(doc).replace(
      'opacity:0.8;',
      'margin-left:3px;opacity:0.8;',
    )
    expect(edited).not.toBe(buildEditableSnapshot(doc))
    const result = commitEditedCss(edited, doc)
    expect(result.fatal).toBe(false)
    expect(result.warnings.some((w) => w.includes('unsupported property'))).toBe(true)
  })

  it('commit-with-no-edits is shape-identical to the original (normalizations only)', () => {
    const doc = makeDoc({ layers: [boxLayer(), hiddenLayer()] })
    const result = commitEditedCss(buildEditableSnapshot(doc), doc)
    expect(result.fatal).toBe(false)
    expect(docShape(result.nextDoc!)).toEqual(docShape(doc))
  })
})

// ── Selection / playhead helpers ───────────────────────────────────────

describe('preserveSelectionByName', () => {
  it('finds a layer case-insensitively and returns its NEW id', () => {
    const doc = makeDoc({ layers: [boxLayer(), hiddenLayer()] })
    const parsed = commitEditedCss(buildEditableSnapshot(doc), doc).nextDoc!
    const renamedId = preserveSelectionByName('BOX', parsed)
    expect(renamedId).toBe(parsed.layers.find((l) => l.name.toLowerCase() === 'box')!.id)
  })

  it('returns null when the layer is gone or the name is empty', () => {
    const doc = makeDoc()
    expect(preserveSelectionByName('Ghost', doc)).toBeNull()
    expect(preserveSelectionByName(null, doc)).toBeNull()
    expect(preserveSelectionByName(undefined, doc)).toBeNull()
    expect(preserveSelectionByName('  ', doc)).toBeNull()
  })
})

describe('clampPlayhead', () => {
  it('clamps into [0, duration]', () => {
    expect(clampPlayhead(500, 1200)).toBe(500)
    expect(clampPlayhead(3000, 1200)).toBe(1200)
    expect(clampPlayhead(-5, 1200)).toBe(0)
    expect(clampPlayhead(10, 0)).toBe(0)
  })
})

// ── Store interplay: commit persists immediately (plan §7 #14) ─────────

vi.mock('@/utils/persistence', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof PersistenceModule
  return {
    ...actual,
    saveToStorage: vi.fn(),
    loadFromStorage: vi.fn(() => null),
    loadPrefs: vi.fn(() => null),
    hasOnboarded: vi.fn(() => false),
    markOnboarded: vi.fn(),
  }
})

describe('replaceDoc after commit flushes autosave immediately', () => {
  it('saveToStorage fires synchronously on replaceDoc (no debounce wait)', async () => {
    const persistence = await import('@/utils/persistence')
    const saveSpy = vi.mocked(persistence.saveToStorage)
    saveSpy.mockClear()

    const { replaceDoc } = await import('@/store')
    const doc = makeDoc({ layers: [boxLayer(), hiddenLayer()] })
    const result = commitEditedCss(buildEditableSnapshot(doc), doc)
    expect(result.fatal).toBe(false)
    replaceDoc(result.nextDoc!)

    expect(saveSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(saveSpy.mock.calls[0][0])
    expect(payload.doc.name).toBe('My Ad')
    expect(payload.doc.layers.map((l: Layer) => l.name).sort()).toEqual(['Box', 'Dot'])
  })
})
