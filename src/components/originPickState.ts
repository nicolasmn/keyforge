import { createSignal } from 'solid-js'

// ── "Pick on stage" mode — shared between the Inspector section and the
// Preview overlay (components/OriginOverlay.tsx).
//
// Transient editor state like selection/playhead: signals OUTSIDE the
// document store, never persisted, and naturally reset when the overlay
// unmounts (tab switches / mobile tab swaps tear down Preview).

const [picking, setPickingInternal] = createSignal(false)

let restoreFocus: (() => void) | null = null

/**
 * Register the trigger button that should regain focus when pick mode exits.
 * Returns an unregister function for onCleanup.
 */
export function registerPickTrigger(restore: () => void): () => void {
  restoreFocus = restore
  return () => {
    if (restoreFocus === restore) restoreFocus = null
  }
}

export { picking as originPicking }

/**
 * Enter/exit pick mode. Exiting returns focus to the registered trigger
 * button so keyboard users aren't stranded (plan §3 gesture contract).
 */
export function setOriginPicking(next: boolean) {
  setPickingInternal(next)
  if (!next) restoreFocus?.()
}
