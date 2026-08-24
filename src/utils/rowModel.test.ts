import { describe, it, expect } from 'vitest'
import {
  TRACK_HEIGHT,
  HEADER_HEIGHT,
  LAYER_ROW_HEIGHT,
  CONTENT_PAD_BOTTOM,
  buildRowModel,
  rowContentHeight,
  rowIndexAt,
  isDisclosureZone,
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

  it('reproduces the legacy math: y = HEADER_HEIGHT + i*TRACK_HEIGHT', () => {
    const rows = buildRowModel(layers)
    expect(rows).toHaveLength(3)
    rows.forEach((row, i) => {
      expect(row.y).toBe(HEADER_HEIGHT + i * TRACK_HEIGHT)
      expect(row.height).toBe(TRACK_HEIGHT)
    })
  })

  it('references the right (layerId, trackId) per row in layer→track order', () => {
    const rows = buildRowModel(layers)
    expect(rows.map((r) => (r.type === 'track' ? r.trackId : r.layerId))).toEqual([
      'T0a',
      'T0b',
      'T1a',
    ])
    expect(rows.map((r) => r.layerId)).toEqual(['L0', 'L0', 'L1'])
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

  it('middle-collapsed model: [L0 tracks…, LayerRow(L1), L2 tracks…] with contiguous ys', () => {
    const rows = buildRowModel(layers)
    expect(rows.map((r) => r.type)).toEqual(['track', 'layer', 'track', 'track', 'track'])
    assertContiguous(rows)
    const l1 = rows[1]
    expect(l1.type).toBe('layer')
    if (l1.type === 'layer') {
      expect(l1.layerId).toBe('L1')
      expect(l1.trackCount).toBe(2)
      expect(l1.kfCount).toBe(2)
    }
    // L2's first row starts exactly where the summary row ended.
    expect(rows[2].y).toBe(l1.y + l1.height)
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
})

describe('buildRowModel — collapsedSet semantics', () => {
  const flagged = [mkLayer('A', [['Ta', [0]]], false), mkLayer('B', [['Tb', [0]]], true)]

  it('flag alone suffices without a set', () => {
    expect(buildRowModel(flagged).map((r) => r.type)).toEqual(['track', 'layer'])
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
    expect(rows.map((r) => r.type)).toEqual(['track', 'layer'])
    const both = buildRowModel([mkLayer('A', [['Ta', [0]]], true)], new Set(['A']))
    expect(both.map((r) => r.type)).toEqual(['layer'])
  })

  it('an empty set leaves flags in charge', () => {
    expect(buildRowModel(flagged, new Set()).map((r) => r.type)).toEqual(['track', 'layer'])
  })
})

describe('buildRowModel — zero-track rider fix', () => {
  it('zero-track expanded layer still emits its LayerRow', () => {
    const rows = buildRowModel([
      mkLayer('L0', [['T0a', [0]]]),
      mkLayer('empty', []),
      mkLayer('L2', [['T2a', [0]]]),
    ])
    expect(rows.map((r) => r.type)).toEqual(['track', 'layer', 'track'])
    assertContiguous(rows)
    const empty = rows[1]
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

describe('rowContentHeight / empty docs', () => {
  it('empty doc → no rows; content height is just ruler + pad (hint path)', () => {
    expect(buildRowModel([])).toEqual([])
    expect(rowContentHeight([])).toBe(HEADER_HEIGHT + CONTENT_PAD_BOTTOM)
  })

  it('sums every row height on top of the header + pad', () => {
    const rows = buildRowModel([
      mkLayer('A', [
        ['Ta', []],
        ['Tb', []],
      ]),
      mkLayer('B', [], true),
    ])
    expect(rowContentHeight(rows)).toBe(HEADER_HEIGHT + 3 * TRACK_HEIGHT + CONTENT_PAD_BOTTOM)
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
    expect(rowIndexAt(rows, HEADER_HEIGHT + 5)).toBe(0)
    expect(rowIndexAt(rows, HEADER_HEIGHT + TRACK_HEIGHT + 5)).toBe(1)
    expect(rowIndexAt(rows, HEADER_HEIGHT + 2 * TRACK_HEIGHT + 5)).toBe(2)
  })

  it('treats band start as inside and band end as past-the-row boundary', () => {
    expect(rowIndexAt(rows, HEADER_HEIGHT)).toBe(0)
    expect(rowIndexAt(rows, HEADER_HEIGHT + TRACK_HEIGHT)).toBe(1)
  })

  it('returns null past the last row', () => {
    const bottom = rows[rows.length - 1].y + rows[rows.length - 1].height
    expect(rowIndexAt(rows, bottom - 0.001)).toBe(2)
    expect(rowIndexAt(rows, bottom)).toBeNull()
    expect(rowIndexAt(rows, bottom + 500)).toBeNull()
  })
})

describe('isDisclosureZone', () => {
  it('boundary values: ≤ DISCLOSURE_ZONE_WIDTH is inside', () => {
    expect(isDisclosureZone(0)).toBe(true)
    expect(isDisclosureZone(8)).toBe(true)
    expect(isDisclosureZone(24)).toBe(true)
    expect(isDisclosureZone(24.01)).toBe(false)
    expect(isDisclosureZone(25)).toBe(false)
  })
})
