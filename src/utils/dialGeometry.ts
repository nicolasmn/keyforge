/**
 * Pure pointer→angle geometry for the inspector's rotation dial.
 *
 * Extracted from RotationDial (Inspector.tsx) so the math is unit-testable
 * without DOM events or a mounted component. No Solid, no DOM here.
 *
 * Convention (matches CSS rotate() and the DevTools angle picker):
 * 0° points up, angles increase clockwise, always wrapped to [0, 360).
 */

/** Wrap any degree measure into [0, 360). Handles negatives and >360. */
export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * Pointer position relative to a center point → dial degrees.
 *
 * The atan2 + wrap math previously lived inline in RotationDial.degFromEvent;
 * this is its exact extraction (integer degrees, wrapped to [0, 360)).
 *
 * A pointer exactly on the center is degenerate (atan2(0,0) → NaN), so we
 * return the wrapped `fallback` instead — callers pass the pre-drag angle so
 * a stray center event can never glitch the needle mid-drag.
 */
export function degFromPoint(
  centerX: number,
  centerY: number,
  clientX: number,
  clientY: number,
  fallback = 0,
): number {
  const dx = clientX - centerX
  const dy = clientY - centerY
  if (dx === 0 && dy === 0) return wrapDeg(Math.round(fallback))
  return wrapDeg(Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 90)
}
