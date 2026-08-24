/**
 * Context-menu viewport placement — pure math, no DOM imports (node-testable,
 * matches rowModel.ts house style). All values are CSS px in VIEWPORT
 * coordinates: the context menu is a fixed-position element anchored at the
 * pointer (`e.clientX/clientY`), so `innerWidth/innerHeight` are its bounds.
 *
 * Rules (context-menus plan D2): default to placing the menu's top-left
 * corner at the cursor; flip horizontally when it would overflow the right
 * edge, vertically when it would overflow the bottom edge; then clamp both
 * axes so the box always keeps MENU_VIEWPORT_MARGIN of breathing room.
 */

/** Breathing room kept between the menu and every viewport edge. */
export const MENU_VIEWPORT_MARGIN = 8

export interface MenuPlacement {
  left: number
  top: number
}

/**
 * Resolve where a `w × h` menu belongs when the user pointed at `(x, y)`.
 *
 * 1. Flip: `x + w + margin > vw` → open leftward (`left = x − w`); same for
 *    the vertical axis (`top = y − h`).
 * 2. Clamp both axes into `[margin, vw − w − margin]` / `[margin, vh − h −
 *    margin]` — never negative, never past the far edge. A menu larger than
 *    the viewport degenerates to the margin on that axis (defined, not
 *    optimal — callers cap oversized menus with max-height instead).
 */
export function placeMenu(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): MenuPlacement {
  let left = x
  let top = y
  if (x + w + MENU_VIEWPORT_MARGIN > vw) left = x - w
  if (y + h + MENU_VIEWPORT_MARGIN > vh) top = y - h
  const maxX = Math.max(MENU_VIEWPORT_MARGIN, vw - w - MENU_VIEWPORT_MARGIN)
  const maxY = Math.max(MENU_VIEWPORT_MARGIN, vh - h - MENU_VIEWPORT_MARGIN)
  return {
    left: Math.min(Math.max(left, MENU_VIEWPORT_MARGIN), maxX),
    top: Math.min(Math.max(top, MENU_VIEWPORT_MARGIN), maxY),
  }
}
