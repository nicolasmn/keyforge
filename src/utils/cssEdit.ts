import type { AnimationDocument, Layer } from '@/types'
import { generateCss } from './css'
import { parseCssToDoc } from './cssImport'
import { slugify } from './slugify'

/**
 * Helpers for editing generated CSS text back into a document — the
 * commit half of the CSS panel's live-editing loop (see
 * docs/plans/2026-08-24-css-live-editing.md, Phase 0).
 *
 * Two data-loss traps make a naive `parse → replaceDoc` commit unsafe,
 * and every helper here exists to close one of them:
 *
 * **R1 — hidden / keyframe-less layers vanish from the editable text.**
 * `generateCss()` filters out layers that are hidden (`visible === false`)
 * or have no keyframes yet, so they are simply absent from the snapshot the
 * user edits. Parsing their edited text back therefore yields a document
 * without them — a naive commit would silently delete those layers. The
 * rescue pass in `commitEditedCss` re-attaches any such layer that the
 * edited text does not mention (matched by name), byte-for-byte unchanged
 * and with its original id. Layers that WERE fully representable in the
 * snapshot but are missing from the edited text were deliberately deleted
 * by the user and are not resurrected.
 *
 * **R2 — the importer clobbers element metadata + document identity.**
 * `parseCssToDoc()` hardcodes default element metadata (`div`, starter CSS)
 * on every parsed layer and names the result `'Imported animation'`.
 * Committing that verbatim would restyle existing layers and rename the
 * user's document. The enrichment pass carries over `currentDoc.name`,
 * `currentDoc.id`, and each matched layer's exact `element` object and
 * display name via case-insensitive slug match (exports slugify layer
 * names, so "Box" comes back as "box" — matched, then restored).
 */

/** Why a layer cannot appear in an editable full-doc snapshot. */
export type SnapshotExclusionReason = 'hidden' | 'no-keyframes'

/**
 * Mirrors the exclusion conditions in `generateCss`/`generateLayerCss`
 * exactly — keep the two in sync or the rescue pass will drift.
 */
export function snapshotExclusionReason(layer: Layer): SnapshotExclusionReason | null {
  if (layer.visible === false) return 'hidden'
  if (!layer.tracks.some((t) => t.keyframes.length > 0)) return 'no-keyframes'
  return null
}

/** Layers excluded from the full-document CSS snapshot (R1). */
export function unrepresentableLayers(doc: AnimationDocument): Layer[] {
  return doc.layers.filter((l) => snapshotExclusionReason(l) !== null)
}

/**
 * The text an editor session starts from. Isolated behind a helper so the
 * hidden-layer policy (R1 — e.g. emitting commented-out sections instead of
 * silently dropping them) can evolve in one place without touching the UI.
 */
export function buildEditableSnapshot(doc: AnimationDocument): string {
  return generateCss(doc)
}

export interface CommitEditedCssResult {
  /**
   * Enriched document ready to hand to `replaceDoc()`; null when the text
   * could not be parsed at all (`fatal === true`, e.g. mid-typing).
   */
  nextDoc: AnimationDocument | null
  /** Parser warnings plus enrichment notices, in order (soft info). */
  warnings: string[]
  /** True when nothing was parseable — no doc was produced. */
  fatal: boolean
}

function matchKey(name: string): string {
  // Exports slugify layer names (`Box` → `kf-box-*`), so the name an edited
  // rule carries back is the slug form. Slug both sides before comparing —
  // this covers case differences AND display-name vs slug differences
  // ("Hero Section!" round-trips as "hero-section").
  return slugify(name)
}

/** Deep plain-object copy so store-proxy objects never leak into nextDoc. */
function cloneLayer(layer: Layer): Layer {
  return {
    ...layer,
    element: { ...layer.element },
    tracks: layer.tracks.map((t) => ({
      ...t,
      keyframes: t.keyframes.map((k) => ({ ...k })),
    })),
  }
}

const HAS_DURATION_RE = /animation-duration\s*:/i

/**
 * Parse CSS edited against `buildEditableSnapshot(currentDoc)` back into a
 * document, repairing everything the parser cannot know about (R2) and
 * restoring what the snapshot format could not represent (R1). Pure — no
 * DOM, no store access; the UI owns `replaceDoc` and selection afterwards.
 *
 * Duration: the parser defaults to 2000ms when no `animation-duration` is
 * found. In an editing context a MISSING companion block is almost always
 * accidental (the export always emits one per layer), so the current
 * document's duration is kept instead of silently resetting it. An explicit
 * duration in the text still wins — editing the companion block legitimately
 * rescales the document.
 */
export function commitEditedCss(
  text: string,
  currentDoc: AnimationDocument,
): CommitEditedCssResult {
  const parsed = parseCssToDoc(text ?? '')
  if (!parsed.doc) {
    return { nextDoc: null, warnings: parsed.warnings, fatal: true }
  }

  const warnings = [...parsed.warnings]

  const byName = new Map<string, Layer>()
  for (const layer of currentDoc.layers) {
    const key = matchKey(layer.name)
    if (!byName.has(key)) byName.set(key, layer)
  }

  // ── R2 enrichment: carry identity + element metadata onto parsed layers ──
  const layers: Layer[] = []
  const presentNames = new Set<string>()
  for (const parsedLayer of parsed.doc.layers) {
    const key = matchKey(parsedLayer.name)
    presentNames.add(key)
    const existing = byName.get(key)
    if (existing) {
      // Keep everything freshly parsed; only restore the display name and
      // the element object the slug-based text cannot represent and the
      // parser had hardcoded defaults for.
      layers.push({ ...parsedLayer, name: existing.name, element: { ...existing.element } })
    } else {
      warnings.push(
        `Layer "${parsedLayer.name}" doesn't match an existing layer — using default element styling.`,
      )
      layers.push(parsedLayer)
    }
  }

  // ── R1 rescue: re-attach layers the snapshot could not represent ──
  for (const oldLayer of currentDoc.layers) {
    const key = matchKey(oldLayer.name)
    if (presentNames.has(key)) continue
    const reason = snapshotExclusionReason(oldLayer)
    if (!reason) continue // representable ⇒ its absence was a deliberate deletion
    layers.push(cloneLayer(oldLayer))
    warnings.push(
      reason === 'hidden'
        ? `Hidden layer "${oldLayer.name}" isn't part of the generated CSS — kept unchanged.`
        : `Layer "${oldLayer.name}" has no keyframes yet — kept unchanged.`,
    )
  }

  const duration = HAS_DURATION_RE.test(text) ? parsed.doc.duration : currentDoc.duration

  return {
    nextDoc: {
      id: currentDoc.id,
      name: currentDoc.name,
      duration,
      layers,
    },
    warnings,
    fatal: false,
  }
}

/**
 * Map a pre-commit selected layer NAME onto the freshly-parsed document.
 * `replaceDoc` reconciles the whole tree, so every id changes; selection
 * survives by identity-of-record (name), not by id. Returns null when the
 * named layer is gone — callers fall back to the first layer (same as the
 * import path in DocBar).
 */
export function preserveSelectionByName(
  oldSelectedName: string | null | undefined,
  nextDoc: AnimationDocument,
): string | null {
  if (!oldSelectedName) return null
  const needle = matchKey(oldSelectedName)
  return nextDoc.layers.find((l) => matchKey(l.name) === needle)?.id ?? null
}

/**
 * Clamp a playhead position to `[0, duration]`. After a commit shrinks the
 * document, the playhead may point past the end where nothing renders.
 */
export function clampPlayhead(playheadMs: number, durationMs: number): number {
  const max = Math.max(0, durationMs)
  return Math.min(Math.max(0, playheadMs), max)
}
