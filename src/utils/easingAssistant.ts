/**
 * Batch easing assistant — plan §3.2 Phase A.
 *
 * AE's keyframe assistants ("Easy Ease", F9) apply one easing to MANY keys
 * at once. Keyforge's selection model is single-keyframe today, so the
 * Phase-A scope is the natural next unit up: the TRACK. One action eases
 * every keyframe of a track, which is how motion designers actually work
 * (a track ≈ one property's whole move). Multi-select (marquee + shift/
 * ctrl-click, plan §2.2) remains the follow-up that generalizes this to
 * arbitrary selections.
 *
 * The updater is injected so the helper stays a pure function over data:
 * components pass the store's updateKeyframe; tests pass a spy. Each
 * keyframe commits as its own mutation through the normal write path, so
 * autosave/guards behave exactly like manual edits.
 */
import type { Track } from '@/types'

/** The "Easy ease" easing: Keyforge's default new-keyframe easing and the
 *  decelerate feel users expect from AE's F9 in this codebase's vocabulary. */
export const EASY_EASE_EASING = 'ease-out'

export type EasingUpdater = (
  layerId: string,
  trackId: string,
  keyframeId: string,
  patch: { easing: string },
) => void

/**
 * Set `easing` on EVERY keyframe of `track` (one update per key).
 * Returns the number of keyframes updated — 0 for an empty track or when
 * every key already carried the target easing (no-op still safe).
 */
export function easeAllTrackKeyframes(
  layerId: string,
  track: Track,
  easing: string,
  updateKf: EasingUpdater,
): number {
  let count = 0
  for (const kf of track.keyframes) {
    if (kf.easing === easing) continue // skip no-op writes (avoids churn)
    updateKf(layerId, track.id, kf.id, { easing })
    count++
  }
  return count
}
