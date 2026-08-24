/**
 * Snapping math — pure functions, no Solid coupling (unit-testable in node).
 *
 * User-driven timeline gestures (ruler click, scrub drag, wheel nudge,
 * keyframe drag) quantize the playhead/keyframe time to a configurable
 * increment. Playback's rAF loop must NEVER snap: animation stays smooth
 * and unsnapped regardless of the preference.
 */

export type SnapIncrement = 'off' | 1 | 10 | 100 | 500 | 1000

/** Valid numeric increments — used by prefs validation and the UI select. */
export const SNAP_VALUES: readonly number[] = [1, 10, 100, 500, 1000]

/**
 * Quantize `t` to the nearest multiple of `increment`, clamped to [0, max].
 *
 * - `'off'` short-circuits and returns `t` untouched (no clamp either — call
 *   sites already clamp via xToTime when snapping is off).
 * - Non-finite input passes through unchanged.
 * - All increments are integers, so results are FP-exact products of
 *   integers within typical ms ranges; no epsilon fixup needed. The wheel
 *   path may feed fractional `t`; snapping normalizes it.
 * - Rounding at exact midpoints is half-up (`1250` @ inc=500 → `1500`) —
 *   documented behavior from Math.round, not banker's rounding.
 */
export function snapTime(t: number, increment: SnapIncrement, max?: number): number {
  if (increment === 'off' || !Number.isFinite(t)) return t
  const snapped = Math.round(t / increment) * increment // integer inc ⇒ exact result
  return Math.max(0, Math.min(max ?? Infinity, snapped))
}
