/**
 * Single-instance easing-editor popover state (plan §3 primary access model).
 *
 * Exactly ONE easing editor exists app-wide; opening it from another surface
 * (another inspector chip or a timeline diamond) retargets the same instance,
 * matching Chrome DevTools' icon-at-the-property popover and killing today's
 * possible stack-of-inline-editors state. Inspector mounts the editor into a
 * body portal keyed off `easingTarget`; Timeline opens it via dbl-click on a
 * diamond — both go through these signals only.
 */
import { createSignal } from 'solid-js'

export interface EasingPopoverAnchor {
  /** Viewport-space point the popover attaches to (chip corner / diamond). */
  x: number
  y: number
}

export interface EasingPopoverTarget {
  layerId: string
  trackId: string
  keyframeId: string
  anchor: EasingPopoverAnchor
  origin: 'inspector' | 'timeline'
  /**
   * #48 focus contract: invoked exactly once when the popover closes
   * (not when it retargets to another keyframe) so focus lands back on
   * the chip/diamond that opened it.
   */
  restoreFocus?: () => void
}

const [target, setTarget] = createSignal<EasingPopoverTarget | null>(null)

/** Currently edited keyframe target, or null when closed. */
export const easingTarget = target

export function openEasingPopover(t: EasingPopoverTarget): void {
  setTarget(t)
}

export function closeEasingPopover(): void {
  setTarget(null)
}

/**
 * Chip toggle: open anchored to this element, or close if already open for
 * the same keyframe. Re-opening from a different surface re-anchors.
 */
export function toggleEasingPopover(
  t: Omit<EasingPopoverTarget, 'anchor'> & { anchor: () => EasingPopoverAnchor },
): void {
  const cur = target()
  if (
    cur &&
    cur.keyframeId === t.keyframeId &&
    cur.layerId === t.layerId &&
    cur.trackId === t.trackId &&
    cur.origin === t.origin
  ) {
    setTarget(null)
    return
  }
  setTarget({ ...t, anchor: t.anchor() })
}

/** True when the given keyframe's editor is open (drives aria-expanded). */
export function isEasingPopoverOpenFor(keyframeId: string): boolean {
  return target()?.keyframeId === keyframeId
}
