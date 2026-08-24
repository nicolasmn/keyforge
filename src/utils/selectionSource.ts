/**
 * Selection-origin hint for timeline↔inspector keyframe cross-highlighting
 * (audit F11).
 *
 * The inspector's KeyframeRow needs to know WHY `selectedKeyframeId` changed:
 * a diamond click on the timeline canvas should scroll the owning row into
 * view, but clicking the row itself must not scroll-jack the user's own
 * click. There is no reactive way to ask "who set this signal", so the
 * setter records its intent here first and the row consumes it inside its
 * selection effect.
 *
 * Deliberately module-level (not a signal): the hint is write-once,
 * read-once plumbing — making it reactive would only invite effects that
 * depend on it by accident.
 */
export type SelectionSource = 'canvas' | 'inspector'

let source: SelectionSource | null = null

/** Call immediately BEFORE setSelectedKeyframeId(...) to record origin. */
export function setKeyframeSelectionSource(s: SelectionSource): void {
  source = s
}

/**
 * Read-and-clear the pending hint. Returns null when the next selection
 * change carries no origin (e.g. programmatic clears) — no auto-scroll.
 */
export function consumeKeyframeSelectionSource(): SelectionSource | null {
  const s = source
  source = null
  return s
}
