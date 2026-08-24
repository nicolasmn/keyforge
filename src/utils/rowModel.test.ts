import { describe, it, expect } from 'vitest'
import {
  TRACK_HEIGHT,
  HEADER_HEIGHT,
  LAYER_ROW_HEIGHT,
  CONTENT_PAD_BOTTOM,
  LABEL_WIDTH,
  KF_HIT_GUARD_PX,
  HEADER_COLUMN_WIDTH,
  buildRowModel,
  rowContentHeight,
  rowIndexAt,
  headerEntries,
  layerHeaderIds,
  type TimelineRow,
} from './rowModel'
import type { Layer } from '@/types'

/** Build a layer from `[trackId, [kfTimes…]]` pairs. */
function mkLayer(id: string, trackDefs: Array<[string, number[]]>, collapsed?: boolean): Layer {
  return {
    id,
    name: `Layer ${id}`,
    visible: true,
    ...(collapsed === undefined ? {} : { collapsed }),
    element: { tag: 'div', text: '', initialCss: '' },
    tracks: trackDefs.map(([trackId, times]) => ({
      id: trackId,
      property: 'opacity' as const,
      keyframes: times.map((time) => ({
        id: `${trackId}-k${time}`,
        time,
        value: '0',
        easing: 'linear',
      })),
    })),
  }
}

function assertContiguous(rows: readonly TimelineRow[]) {
  let cursor = HEADER_HEIGHT
  for (const row of rows) {
    expect(row.y).toBe(cursor)
    expect(row.height).toBeGreaterThan(0)
    cursor = row.y + row.height
  }
}

describe('buildRowModel — flat parity (all expanded)', () => {
  const layers = [
    mkLayer('L0', [
      ['T0a', [0]],
      ['T0b', []],
    ]),
    mkLayer('L1', [['T1a', [100, 200]]]),
  ]

  it('reproduces the uniform rhythm: y = HEADER_HEIGHT + i*TRACK_HEIGHT (header bands included)', () => {
    const rows = buildRowModel(layers)
    // One header band per layer + one row per track.
    expect(rows).toHaveLength(5)
    rows.forEach((row, i) => {
      expect(row.y).toBe(HEADER_HEIGHT + i * TRACK_HEIGHT)
      expect(row.height).toBe(TRACK_HEIGHT)
    })
  })

  it('references the right (layerId, trackId) per row in layer→track order', () => {
    const rows = buildRowModel(layers)
    expect(rows.map((r) => r.type)).toEqual(['layer', 'track', 'track', 'layer', 'track'])
    expect(rows.map((r) => (r.type === 'track' ? r.trackId : null))).toEqual([
      null,
      'T0a',
      'T0b',
      null,
      'T1a',
    ])
    expect(rows.map((r) => r.layerId)).toEqual(['L0', 'L0', 'L0', 'L1', 'L1'])
    const l0 = rows[0]
    if (l0.type === 'layer') {
      expect(l0.trackCount).toBe(2)
      expect(l0.kfCount).toBe(1)
    }
  })
})

describe('buildRowModel — collapse geometry', () => {
  const layers = [
    mkLayer('L0', [['T0a', [0]]]),
    mkLayer(
      'L1',
      [
        ['T1a', [10]],
        ['T1b', [20]],
      ],
      true,
    ),
    mkLayer('L2', [
      ['T2a', [30]],
      ['T2b', [40]],
      ['T2c', [50]],
    ]),
  ]

  it('middle-collapsed model: header band per layer; collapsed layer emits ONLY its band', () => {
    const rows = buildRowModel(layers)
    expect(rows.map((r) => r.type)).toEqual([
      'layer',
      'track',
      'layer',
      'layer',
      'track',
      'track',
      'track',
    ])
    assertContiguous(rows)
    const l1Band = rows[2]
    expect(l1Band.type).toBe('layer')
    if (l1Band.type === 'layer') {
      expect(l1Band.layerId).toBe('L1')
      expect(l1Band.trackCount).toBe(2)
      expect(l1Band.kfCount).toBe(2)
    }
    // L2's header band starts exactly where L1's summary band ended.
    expect(rows[3].y).toBe(l1Band.y + l1Band.height)
  })

  it('all collapsed: one LayerRow per layer, doc order preserved, counts correct', () => {
    const allCollapsed = layers.map((l) => ({ ...l, collapsed: true }))
    const rows = buildRowModel(allCollapsed)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.type === 'layer')).toBe(true)
    expect(rows.map((r) => r.layerId)).toEqual(['L0', 'L1', 'L2'])
    assertContiguous(rows)
    const counts = rows.map((r) => (r.type === 'layer' ? [r.trackCount, r.kfCount] : null))
    expect(counts).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ])
    // Summary rows are full-height rows.
    expect(rows.every((r) => r.height === LAYER_ROW_HEIGHT)).toBe(true)
  })

  it('collapse toggle changes row count only, never the row rhythm', () => {
    const expanded = buildRowModel(layers)
    const collapsed = buildRowModel(layers.map((l) => ({ ...l, collapsed: true })))
    expect(new Set(expanded.map((r) => r.height))).toEqual(new Set(collapsed.map((r) => r.height)))
  })
})

describe('buildRowModel — collapsedSet semantics', () => {
  const flagged = [mkLayer('A', [['Ta', [0]]], false), mkLayer('B', [['Tb', [0]]], true)]

  it('flag alone suffices without a set', () => {
    expect(buildRowModel(flagged).map((r) => r.type)).toEqual(['layer', 'track', 'layer'])
  })

  it('collapsedSet overrides a false flag', () => {
    const rows = buildRowModel(flagged, new Set(['A']))
    expect(rows.map((r) => r.type)).toEqual(['layer', 'layer'])
  })

  it('union semantics: flag OR set collapses', () => {
    const rows = buildRowModel(
      [mkLayer('A', [['Ta', [0]]]), mkLayer('B', [['Tb', [0]]])],
      new Set(['B']),
    )
    expect(rows.map((r) => r.type)).toEqual(['layer', 'track', 'layer'])
    const both = buildRowModel([mkLayer('A', [['Ta', [0]]], true)], new Set(['A']))
    expect(both.map((r) => r.type)).toEqual(['layer'])
  })

  it('an empty set leaves flags in charge', () => {
    expect(buildRowModel(flagged, new Set()).map((r) => r.type)).toEqual([
      'layer',
      'track',
      'layer',
    ])
  })
})

describe('buildRowModel — zero-track layers', () => {
  it('zero-track expanded layer emits its header band (and no track rows)', () => {
    const rows = buildRowModel([
      mkLayer('L0', [['T0a', [0]]]),
      mkLayer('empty', []),
      mkLayer('L2', [['T2a', [0]]]),
    ])
    expect(rows.map((r) => r.type)).toEqual(['layer', 'track', 'layer', 'layer', 'track'])
    assertContiguous(rows)
    const empty = rows[2]
    expect(empty.type).toBe('layer')
    if (empty.type === 'layer') {
      expect(empty.layerId).toBe('empty')
      expect(empty.trackCount).toBe(0)
      expect(empty.kfCount).toBe(0)
    }
  })

  it('zero-track collapsed layer emits exactly one LayerRow too', () => {
    const rows = buildRowModel([mkLayer('empty', [], true)])
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('layer')
  })
})

describe('buildRowModel — heights param (coarse-pointer targets)', () => {
  const layers = [
    mkLayer('L0', [
      ['T0a', [0]],
      ['T0b', []],
    ]),
    mkLayer('L1', [['T1a', []]], true),
  ]

  it('defaults are byte-identical to the constants', () => {
    const rows = buildRowModel(layers)
    expect(rows.every((r) => r.height === TRACK_HEIGHT && r.height === LAYER_ROW_HEIGHT)).toBe(true)
    expect(rowContentHeight(rows)).toBe(HEADER_HEIGHT + 4 * TRACK_HEIGHT + CONTENT_PAD_BOTTOM)
  })

  it('44px variant stays contiguous and flows into content height', () => {
    const rows = buildRowModel(layers, undefined, { trackHeight: 44, layerRowHeight: 44 })
    assertContiguous(rows)
    expect(rows.every((r) => r.height === 44)).toBe(true)
    expect(rowContentHeight(rows)).toBe(HEADER_HEIGHT + 4 * 44 + CONTENT_PAD_BOTTOM)
  })

  it('heights can be overridden independently', () => {
    const rows = buildRowModel(layers, undefined, { layerRowHeight: 40 })
    expect(rows.filter((r) => r.type === 'layer').every((r) => r.height === 40)).toBe(true)
    expect(rows.filter((r) => r.type === 'track').every((r) => r.height === TRACK_HEIGHT)).toBe(
      true,
    )
    assertContiguous(rows)
  })

  it('rowIndexAt honors overridden heights end-to-end', () => {
    const rows = buildRowModel(layers, undefined, { trackHeight: 44, layerRowHeight: 44 })
    expect(rowIndexAt(rows, HEADER_HEIGHT + 43)).toBe(0) // L0 header band
    expect(rowIndexAt(rows, HEADER_HEIGHT + 44)).toBe(1) // T0a
    expect(rowIndexAt(rows, HEADER_HEIGHT + 3 * 44 + 5)).toBe(3) // L1 summary
    expect(rowIndexAt(rows, HEADER_HEIGHT + 4 * 44)).toBeNull()
  })
})

describe('guard band + header column width (plan §2.2)', () => {
  it('HEADER_COLUMN_WIDTH leaves a KF_HIT_GUARD_PX strip of canvas before x=LABEL_WIDTH', () => {
    expect(LABEL_WIDTH).toBe(160)
    expect(KF_HIT_GUARD_PX).toBe(14)
    expect(HEADER_COLUMN_WIDTH).toBe(LABEL_WIDTH - KF_HIT_GUARD_PX)
    expect(HEADER_COLUMN_WIDTH).toBe(146)
  })
})

describe('headerEntries / layerHeaderIds', () => {
  const layers = [
    mkLayer('A', [
      ['Ta', [0]],
      ['Tb', [10]],
    ]),
    mkLayer('B', [['Tc', [20]]], true),
  ]
  const rows = buildRowModel(layers)

  it('emits LAYER-ONLY entries (Phase A: track labels stay on canvas)', () => {
    const entries = headerEntries(rows)
    // Two layers → two layer-only entries; tracks are canvas-painted.
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.type === 'layer')).toBe(true)
    entries.forEach((entry) => {
      const srcRow = rows.find((r) => r.layerId === entry.layerId)!
      expect(entry.top).toBe(srcRow.y - HEADER_HEIGHT)
      expect(entry.height).toBe(srcRow.height)
    })
  })

  it('exactly one layer-header per layer, in doc order, regardless of collapse', () => {
    expect(layerHeaderIds(rows)).toEqual(['A', 'B'])
    // Flip collapse states — order/count of layer headers is invariant.
    const flipped = buildRowModel([
      mkLayer('A', [['Ta', [0]]], true),
      mkLayer(
        'B',
        [
          ['Tc', [0]],
          ['Td', [5]],
        ],
        false,
      ),
    ])
    expect(layerHeaderIds(flipped)).toEqual(['A', 'B'])
    expect(layerHeaderIds(buildRowModel([]))).toEqual([])
  })
})

describe('rowIndexAt', () => {
  const rows = buildRowModel([
    mkLayer('A', [
      ['Ta', []],
      ['Tb', []],
    ]),
    mkLayer('B', [['Tc', []]], true),
  ])

  it('returns null above the header', () => {
    expect(rowIndexAt(rows, 0)).toBeNull()
    expect(rowIndexAt(rows, HEADER_HEIGHT - 0.5)).toBeNull()
  })

  it('hits the exact row mid-band', () => {
    expect(rowIndexAt(rows, HEADER_HEIGHT + 5)).toBe(0) // A's header band
    expect(rowIndexAt(rows, HEADER_HEIGHT + TRACK_HEIGHT + 5)).toBe(1) // Ta
    expect(rowIndexAt(rows, HEADER_HEIGHT + 2 * TRACK_HEIGHT + 5)).toBe(2) // Tb
    expect(rowIndexAt(rows, HEADER_HEIGHT + 3 * TRACK_HEIGHT + 5)).toBe(3) // B's summary
  })

  it('treats band start as inside and band end as past-the-row boundary', () => {
    expect(rowIndexAt(rows, HEADER_HEIGHT)).toBe(0)
    expect(rowIndexAt(rows, HEADER_HEIGHT + TRACK_HEIGHT)).toBe(1)
  })

  it('returns null past the last row', () => {
    const bottom = rows[rows.length - 1].y + rows[rows.length - 1].height
    expect(rowIndexAt(rows, bottom - 0.001)).toBe(3)
    expect(rowIndexAt(rows, bottom)).toBeNull()
    expect(rowIndexAt(rows, bottom + 500)).toBeNull()
  })
})
