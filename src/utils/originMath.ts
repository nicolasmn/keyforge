import type { OriginPoint } from '@/types'

// ── Transform-origin math & validation ────────────────────────────────
// Pure functions (no DOM, no Solid coupling) so picker geometry and the
// structured-origin merge unit-test in node. The interactive pieces live in
// components/OriginOverlay.tsx; this module owns everything testable.
// Spec source: docs/plans/2026-08-24-transform-origin.md §2/§3/§4.

/**
 * A single transform-origin component: signed number + % or length unit.
 * Rejects keywords (left/top/center — UI presets convert to % first),
 * bare numbers, angles and anything else CSS wouldn't accept here.
 */
export const ORIGIN_COMPONENT_RE = /^-?\d*\.?\d+(%|px|em|rem|vw|vh)$/

/** Units offered by the X/Y inputs and accepted by the store mutation. */
export const ORIGIN_UNITS = ['%', 'px', 'em', 'rem', 'vw', 'vh'] as const

export type OriginUnit = (typeof ORIGIN_UNITS)[number]

/** Split a component into number + unit; null when it doesn't validate. */
export function splitOriginComponent(value: string): { num: string; unit: OriginUnit } | null {
  const m = /^(-?\d*\.?\d+)(%|px|em|rem|vw|vh)$/.exec(value.trim())
  if (!m) return null
  return { num: m[1], unit: m[2] as OriginUnit }
}

export function isValidOriginComponent(value: string): boolean {
  return ORIGIN_COMPONENT_RE.test(value.trim())
}

export function isValidOriginPair(x: string, y: string): boolean {
  return isValidOriginComponent(x) && isValidOriginComponent(y)
}

export function isValidOrigin(o: unknown): o is OriginPoint {
  if (typeof o !== 'object' || o === null) return false
  const p = o as Partial<OriginPoint>
  return typeof p.x === 'string' && typeof p.y === 'string' && isValidOriginPair(p.x, p.y)
}

/**
 * Clamp to [0,100] and round to one decimal — the plan §3 precision for
 * pointer-derived percentages.
 */
export function clampPercent(n: number): number {
  const clamped = Math.min(100, Math.max(0, n))
  return Math.round(clamped * 10) / 10
}

/** Position box in canvas LAYOUT space (pre-scale, pre-transform). */
export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Pointer position → canvas-layout percentages.
 *
 * Ratio-based and therefore scale-invariant (plan §3): the numerator and
 * denominator are measured in the SAME scaled space (the pick surface covers
 * the stage inset:0), so the result equals the unscaled layout percentage
 * regardless of --preview-scale zoom. Clamps to 0–100, rounds to 0.1.
 * NOTE: measures the OVERLAY's rect — never getBoundingClientRect of the
 * target element (that returns the post-transform AABB).
 */
export function originFromPointer(clientX: number, clientY: number, rect: RectLike): OriginPoint {
  const w = rect.width > 0 ? rect.width : 1
  const h = rect.height > 0 ? rect.height : 1
  const x = clampPercent(((clientX - rect.left) / w) * 100)
  const y = clampPercent(((clientY - rect.top) / h) * 100)
  return { x: `${x}%`, y: `${y}%` }
}

export interface OriginPreset {
  label: string
  aria: string
  /** Percentage along X/Y (presets convert the left/top/center keywords to %). */
  x: number
  y: number
}

/** 9-point preset grid, reading order TL→BR. */
export const ORIGIN_PRESETS: readonly OriginPreset[] = [
  { label: '↖', aria: 'Set origin top left', x: 0, y: 0 },
  { label: '↑', aria: 'Set origin top center', x: 50, y: 0 },
  { label: '↗', aria: 'Set origin top right', x: 100, y: 0 },
  { label: '←', aria: 'Set origin middle left', x: 0, y: 50 },
  { label: '·', aria: 'Set origin center', x: 50, y: 50 },
  { label: '→', aria: 'Set origin middle right', x: 100, y: 50 },
  { label: '↙', aria: 'Set origin bottom left', x: 0, y: 100 },
  { label: '↓', aria: 'Set origin bottom center', x: 50, y: 100 },
  { label: '↘', aria: 'Set origin bottom right', x: 100, y: 100 },
]

/**
 * Magnet: the preset point within `threshold` % on BOTH axes, else null.
 * Applied after axis constraints during drag gestures.
 */
export function snapToPreset(xPct: number, yPct: number, threshold = 2): OriginPreset | null {
  for (const p of ORIGIN_PRESETS) {
    if (Math.abs(p.x - xPct) <= threshold && Math.abs(p.y - yPct) <= threshold) return p
  }
  return null
}

/** References needed to resolve em/rem/vw/vh components to px off-DOM. */
export interface OriginResolveContext {
  /** Element's own computed font-size (em reference). */
  fontSize: number
  /** Root computed font-size (rem reference). */
  rootFontSize: number
  viewportWidth: number
  viewportHeight: number
}

/**
 * Resolve ONE origin component to px along its axis inside a border box.
 * % resolves against `dimension`, px is absolute; em/rem/vw/vh resolve via
 * ctx references. Percentage origins resolve against the BORDER box, and
 * offsetWidth/Height ARE border-box dimensions — consistent by construction.
 */
export function resolveOriginComponent(
  value: string,
  dimension: number,
  ctx: OriginResolveContext,
): number {
  const c = splitOriginComponent(value)
  if (!c) return dimension / 2 // defensive: invalid falls back to center
  const n = Number.parseFloat(c.num)
  switch (c.unit) {
    case '%':
      return (n / 100) * dimension
    case 'px':
      return n
    case 'em':
      return n * ctx.fontSize
    case 'rem':
      return n * ctx.rootFontSize
    case 'vw':
      return (n / 100) * ctx.viewportWidth
    case 'vh':
      return (n / 100) * ctx.viewportHeight
  }
}

/** Pixel point an origin resolves to inside a layout box (border box). */
export function originPixelPoint(origin: OriginPoint, box: RectLike, ctx: OriginResolveContext) {
  return {
    x: box.left + resolveOriginComponent(origin.x, box.width, ctx),
    y: box.top + resolveOriginComponent(origin.y, box.height, ctx),
  }
}

/**
 * Split a raw declaration string into a style object ("prop" → "value"),
 * skipping fragments without a colon. Moved here from Preview.tsx so the
 * origin merge can be tested purely.
 */
export function parseCssString(css: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const decl of css.split(';')) {
    const colon = decl.indexOf(':')
    if (colon === -1) continue
    const prop = decl.slice(0, colon).trim()
    const value = decl.slice(colon + 1).trim()
    if (prop && value) result[prop] = value
  }
  return result
}

/**
 * Preview inline styles for a layer element: initialCss declarations with
 * the STRUCTURED transform-origin applied LAST, so it wins over any
 * transform-origin declared inside initialCss (documented precedence,
 * transform-origin plan §2). The visibility override is NOT handled here —
 * callers spread it AFTER this helper so it always applies last.
 */
export function mergeInitialCss(el: {
  initialCss: string
  origin?: OriginPoint
}): Record<string, string> {
  const style = parseCssString(el.initialCss)
  if (el.origin && isValidOriginPair(el.origin.x, el.origin.y)) {
    style['transform-origin'] = `${el.origin.x} ${el.origin.y}`
  }
  return style
}
