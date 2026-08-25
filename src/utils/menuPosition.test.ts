import { describe, it, expect } from 'vitest'
import { MENU_VIEWPORT_MARGIN, placeMenu, type MenuPlacement } from './menuPosition'

const inBox = (p: MenuPlacement, w: number, h: number, vw: number, vh: number) =>
  p.left >= MENU_VIEWPORT_MARGIN &&
  p.top >= MENU_VIEWPORT_MARGIN &&
  p.left + w <= vw - MENU_VIEWPORT_MARGIN &&
  p.top + h <= vh - MENU_VIEWPORT_MARGIN

describe('placeMenu', () => {
  it('places the menu at the cursor when there is room (margins respected)', () => {
    // 200×150 menu pointed at (100, 80) in a 1280×800 viewport — fits.
    expect(placeMenu(100, 80, 200, 150, 1280, 800)).toEqual({ left: 100, top: 80 })
    // Pointing exactly at the margin boundary still counts as fitting:
    // x + w + margin === vw → not "greater than" → no flip needed.
    expect(placeMenu(1070, 80, 200, 150, 1280, 800)).toEqual({ left: 1070, top: 80 })
  })

  it('flips horizontally near the right edge (opens left of the cursor)', () => {
    // x + w + margin = 1200 + 200 + 8 > 1280 → left = x − w = 1000.
    expect(placeMenu(1200, 100, 200, 150, 1280, 800)).toEqual({ left: 1000, top: 100 })
  })

  it('flips vertically near the bottom edge (opens above the cursor)', () => {
    // y + h + margin = 700 + 150 + 8 > 800 → top = y − h = 550.
    expect(placeMenu(100, 700, 200, 150, 1280, 800)).toEqual({ left: 100, top: 550 })
  })

  it('flips both axes in the bottom-right corner and stays inside the viewport', () => {
    const p = placeMenu(1250, 780, 200, 150, 1280, 800)
    expect(p.left).toBe(1050) // flipped
    expect(p.top).toBe(630) // flipped
    expect(inBox(p, 200, 150, 1280, 800)).toBe(true)
  })

  it('clamps to the margin when the flip lands past the left/top edge', () => {
    // Narrow viewport: x + w + margin = 150 + 200 + 8 > 300 → flip wants
    // left = 150 − 200 = −50 → clamped to margin instead of going negative.
    const p = placeMenu(150, 300, 200, 150, 300, 800)
    expect(p.left).toBe(MENU_VIEWPORT_MARGIN)
    expect(p.top).toBe(300)
    // Same on the vertical axis: y + h + margin = 20 + 150 + 8 > 170 →
    // flip wants top = 20 − 150 = −130 → clamped to margin.
    const p2 = placeMenu(600, 20, 200, 150, 1280, 170)
    expect(p2.left).toBe(600)
    expect(p2.top).toBe(MENU_VIEWPORT_MARGIN)
  })

  it('clamps a huge menu near the origin to the margin, never negative', () => {
    const p = placeMenu(0, 0, 900, 700, 1280, 800)
    // No flip (0 + 900 + 8 ≤ 1280), but left = 0 < margin → clamped.
    expect(p).toEqual({ left: MENU_VIEWPORT_MARGIN, top: MENU_VIEWPORT_MARGIN })
  })

  it('degenerates gracefully when the menu is larger than the viewport', () => {
    const p = placeMenu(500, 400, 2000, 1600, 1280, 800)
    expect(p).toEqual({ left: MENU_VIEWPORT_MARGIN, top: MENU_VIEWPORT_MARGIN })
  })
})
