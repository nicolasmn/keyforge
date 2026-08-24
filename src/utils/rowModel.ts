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
/**
 * Width of the label strip (CSS px): the DOM header column plus a guard
 * band live inside it. Lanes start at x = LABEL_WIDTH; timeToX/xToTime,
 * ruler label clamping and wheel/duration math all derive from this.
 */
export const LABEL_WIDTH = 160
/**
 * Guard band (CSS px) that must stay clear of any DOM covering the label
 * strip: keyframes centered at t=0 grab [LABEL_WIDTH−14, LABEL_WIDTH+14]
 * and a playhead at t≈0 grabs ±6 around x = LABEL_WIDTH (plan §2.2).
 */
export const KF_HIT_GUARD_PX = 14
/**
 * Width of the DOM row-header column: LABEL_WIDTH minus the guard band,
 * so t=0 keyframe/playhead grab bands stay fully on the canvas.
 */
export const HEADER_COLUMN_WIDTH = LABEL_WIDTH - KF_HIT_GUARD_PX

/** Per-call overrides of the default row heights (e.g. 44px coarse-pointer targets). */
export interface RowHeights {
  /** Height of each track lane. Defaults to TRACK_HEIGHT. */
  trackHeight?: number
  /** Height of each layer header band. Defaults to LAYER_ROW_HEIGHT. */
  layerRowHeight?: number
}

export interface TrackRow {
  type: 'track'
  /** Top edge in CSS px, measured from the canvas top (ruler included). */
  y: number
  /** Row height in CSS px (TRACK_HEIGHT unless overridden via heights). */
  height: number
  layerId: string
  trackId: string
}

export interface LayerRow {
  type: 'layer'
  y: number
  /** Row height in CSS px (LAYER_ROW_HEIGHT unless overridden via heights). */
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
 * area. Every layer emits exactly ONE header LayerRow (its control strip:
 * chevron / eye / name live there), followed by one TrackRow per track
 * when the layer is expanded. Collapsed layers emit ONLY their LayerRow,
 * so a collapse toggle changes row count only — never row rhythm.
 *
 * A layer counts as collapsed iff `layer.collapsed === true` OR it appears
 * in `collapsedSet` (union semantics — lets tests drive collapse without
 * building flagged Layer objects; the store passes nothing and relies on
 * the flag).
 *
 * Rows are contiguous — each row's `y` equals the previous row's
 * `y + height`; no gaps, no overlaps. Deterministic given
 * `(layers, collapsedSet, heights)`; reads no signals/stores.
 */
export function buildRowModel(
  layers: readonly Layer[],
  collapsedSet?: ReadonlySet<string>,
  heights?: RowHeights,
): TimelineRow[] {
  const trackH = heights?.trackHeight ?? TRACK_HEIGHT
  const layerH = heights?.layerRowHeight ?? LAYER_ROW_HEIGHT
  const rows: TimelineRow[] = []
  let cursor = HEADER_HEIGHT
  for (const layer of layers) {
    const kfCount = layer.tracks.reduce((sum, t) => sum + t.keyframes.length, 0)
    // Header band — every layer gets one, expanded or not (the unified
    // row-header column anchors its chevron/eye/name here).
    rows.push({
      type: 'layer',
      y: cursor,
      height: layerH,
      layerId: layer.id,
      trackCount: layer.tracks.length,
      kfCount,
    })
    cursor += layerH
    if (!isCollapsed(layer, collapsedSet)) {
      for (const track of layer.tracks) {
        rows.push({
          type: 'track',
          y: cursor,
          height: trackH,
          layerId: layer.id,
          trackId: track.id,
        })
        cursor += trackH
      }
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

export type RowHeaderEntry =
  | { type: 'layer'; top: number; height: number; layerId: string }
  | { type: 'track'; top: number; height: number; layerId: string; trackId: string }

/**
 * One header-column entry per canvas row: identical vertical geometry
 * shifted out of the ruler (`top = y − HEADER_HEIGHT`). The DOM column
 * absolutely positions each `.row-header` at `top` with `height`, so the
 * column and the canvas can never drift apart — they read the same memo.
 */
export function headerEntries(rows: readonly TimelineRow[]): RowHeaderEntry[] {
  return rows.map((row) =>
    row.type === 'layer'
      ? { type: 'layer', top: row.y - HEADER_HEIGHT, height: row.height, layerId: row.layerId }
      : {
          type: 'track',
          top: row.y - HEADER_HEIGHT,
          height: row.height,
          layerId: row.layerId,
          trackId: row.trackId,
        },
  )
}

/**
 * Layer ids in header-column order — exactly ONE id per layer, in doc
 * order, regardless of collapse state. This invariant is what will make
 * the column a sound drag-and-drop substrate in Phase B (headers never
 * disappear mid-drag the way canvas track rows do).
 */
export function layerHeaderIds(rows: readonly TimelineRow[]): string[] {
  const ids: string[] = []
  for (const row of rows) {
    if (row.type === 'layer' && !ids.includes(row.layerId)) ids.push(row.layerId)
  }
  return ids
}
