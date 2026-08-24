import type { Layer } from '@/types'

// ── Timeline row model (single source of truth) ──────────────────────
// Pure, no Solid imports, unit-testable in node (matches the house style
// of persistence.ts). All values are CSS px — never device px. Consumers
// (Timeline draw/hit-test/cursor/resize) multiply by dpr at the edge.

/** Height of one track lane. Moved here from Timeline.tsx so the model owns the geometry constants. */
export const TRACK_HEIGHT = 36
/** Ruler height above the first row. */
export const HEADER_HEIGHT = 28
/**
 * Summary-row height; v1 keeps it equal to TRACK_HEIGHT so a collapse
 * toggle changes row count only, never row rhythm.
 */
export const LAYER_ROW_HEIGHT = TRACK_HEIGHT
/** Extra CSS px added below the last row when sizing the canvas. */
export const CONTENT_PAD_BOTTOM = 2
/** Disclosure click-zone width inside the label gutter (CSS px). */
export const DISCLOSURE_ZONE_WIDTH = 24

export interface TrackRow {
  type: 'track'
  /** Top edge in CSS px, measured from the canvas top (ruler included). */
  y: number
  /** TRACK_HEIGHT. */
  height: number
  layerId: string
  trackId: string
}

export interface LayerRow {
  type: 'layer'
  y: number
  /** LAYER_ROW_HEIGHT. */
  height: number
  layerId: string
  /** Tracks owned by this layer — shown as "N tracks" on the summary. */
  trackCount: number
  /** Total keyframes across all of the layer's tracks — "M kfs". */
  kfCount: number
}

export type TimelineRow = TrackRow | LayerRow

function isCollapsed(layer: Layer, collapsedSet?: ReadonlySet<string>): boolean {
  return layer.collapsed === true || collapsedSet?.has(layer.id) === true
}

/**
 * Single source of truth for the vertical layout of the timeline's lanes
 * area, replacing three hand-rolled flat enumerations (draw, hit-testing,
 * resize). A layer renders its per-track rows expanded by default, or ONE
 * summary LayerRow when it is collapsed.
 *
 * A layer counts as collapsed iff `layer.collapsed === true` OR it appears
 * in `collapsedSet` (union semantics — lets tests drive collapse without
 * building flagged Layer objects; the store passes nothing and relies on
 * the flag).
 *
 * Zero-track layers always emit their LayerRow (rider fix): before, they
 * rendered zero rows and were literally invisible in the timeline.
 *
 * Rows are contiguous — each row's `y` equals the previous row's
 * `y + height`; no gaps, no overlaps. Deterministic given
 * `(layers, collapsedSet)`; reads no signals/stores.
 */
export function buildRowModel(
  layers: readonly Layer[],
  collapsedSet?: ReadonlySet<string>,
): TimelineRow[] {
  const rows: TimelineRow[] = []
  let cursor = HEADER_HEIGHT
  for (const layer of layers) {
    const kfCount = layer.tracks.reduce((sum, t) => sum + t.keyframes.length, 0)
    if (layer.tracks.length > 0 && !isCollapsed(layer, collapsedSet)) {
      for (const track of layer.tracks) {
        rows.push({
          type: 'track',
          y: cursor,
          height: TRACK_HEIGHT,
          layerId: layer.id,
          trackId: track.id,
        })
        cursor += TRACK_HEIGHT
      }
    } else {
      // Collapsed summary row — or the rider fix for zero-track layers,
      // which emit their layer row even while expanded so they stay visible.
      rows.push({
        type: 'layer',
        y: cursor,
        height: LAYER_ROW_HEIGHT,
        layerId: layer.id,
        trackCount: layer.tracks.length,
        kfCount,
      })
      cursor += LAYER_ROW_HEIGHT
    }
  }
  return rows
}

/** Canvas content height below nothing: ruler + Σ row heights + bottom pad. */
export function rowContentHeight(rows: readonly TimelineRow[]): number {
  let total = 0
  for (const row of rows) total += row.height
  return HEADER_HEIGHT + total + CONTENT_PAD_BOTTOM
}

/**
 * Index of the row whose vertical band contains `yCss`, or null when the
 * point sits over the ruler (`y < HEADER_HEIGHT`) or past the last row.
 * Linear scan is fine at expected scale (<100 rows).
 */
export function rowIndexAt(rows: readonly TimelineRow[], yCss: number): number | null {
  if (yCss < HEADER_HEIGHT) return null
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (yCss >= row.y && yCss < row.y + row.height) return i
  }
  return null
}

/**
 * True when x sits inside a LayerRow's disclosure click zone. Only
 * meaningful within a LayerRow's band — callers check that separately.
 */
export function isDisclosureZone(xCss: number): boolean {
  return xCss <= DISCLOSURE_ZONE_WIDTH
}
