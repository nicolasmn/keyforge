/**
 * Pure math for the inspector's rotation-dial live-feedback model.
 *
 * Complements dialGeometry (pointer position → wrapped angle) with the two
 * steps that turn it into continuous, quantized values:
 *   1. unwrapAround — dialGeometry returns integers wrapped to [0, 360); a
 *      drag crossing the top of the circle must read as 365, not -355.
 *      Reconstructs the continuous measure around the pre-drag origin via
 *      shortest-path delta, preserving the authored magnitude (720 stays
 *      >360-relative).
 *   2. quantizeAngle — snaps a continuous angle onto the unified modifier
 *      ladder (1° default · Alt 0.1° fine · Shift 10° coarse), anchored at
 *      the pre-drag angle so grabbing an off-lattice value never jumps.
 *
 * No DOM, no Solid — unit-testable. See fields.tsx RotationDial for wiring.
 */
import { wrapDeg } from './dialGeometry'
import { stepWithModifiers, type ScrubModifiers } from './scrub'

export function unwrapAround(originDeg: number, wrappedDeg: number): number {
  const delta = ((((wrappedDeg - wrapDeg(originDeg)) % 360) + 540) % 360) - 180
  return originDeg + delta
}

/** Quantize a continuous angle to the active modifier ladder, anchored at anchorDeg. */
export function quantizeAngle(
  anchorDeg: number,
  rawDeg: number,
  modifiers: ScrubModifiers,
): number {
  const step = stepWithModifiers(1, modifiers) // angles: 1° base step
  const snapped = anchorDeg + Math.round((rawDeg - anchorDeg) / step) * step
  // trim ÷10-fine binary float noise (350.30000000000004 → 350.3)
  return Number(snapped.toFixed(3))
}
