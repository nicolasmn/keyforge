/**
 * Shared easing-curve sampling + framing (plan §3 "mini-curve chip" and §5
 * sampler groundwork; #84's adaptive y-scale generalized).
 *
 * Every NEW rendering surface for easings — inspector chip thumbnails,
 * preset-grid thumbnails, timeline segment glyphs — must sample through
 * `sampleEasing` and frame through `easingYExtent`/`paddedExtent` so
 * overshoot shapes (`anticipate`, `overshoot`, `settle`, springs) render
 * truthfully. A thumbnail that silently clamps Y to [0,1] misrepresents
 * exactly the curves this app exists to preview (plan §1.3, #84 constraint).
 *
 * Pure module: no store imports, safe for unit tests in node.
 */
import { BUILTIN_PRESETS, parseCubicBezier, evalCubicBezier } from './easing-presets'
import { parseLinearEasing, type LinearStop } from './spring'

export interface CurvePoint {
  /** Time progress 0..1. */
  t: number
  /** Eased value at t — may lie outside [0,1] (overshoot/anticipation). */
  v: number
}

export type BezierHandles = [number, number, number, number]

/**
 * Sample a CSS easing value at progress t.
 * Resolution order:
 *   1. `linear` keyword → identity;
 *   2. cubic-bezier(...) literal → evalCubicBezier;
 *   3. built-in preset name or exact value ('ease-out', 'ease', …);
 *   4. linear(...) stop list → piecewise-linear interpolation between stops
 *      (progress-normalized exactly like the editor's canvas plot).
 * Returns null when unsupported (`steps(` until Phase L4) or malformed —
 * callers fall back to a straight line rather than a wrong shape.
 */
export function sampleEasing(value: string, t: number): number | null {
  const v = value.trim()
  if (!v) return null
  if (v === 'linear') return clamp01(t)

  const bezier = parseCubicBezier(v)
  if (bezier) return evalCubicBezier(clamp01(t), bezier)

  const builtin = resolveBuiltin(v)
  if (builtin) return sampleEasing(builtin, t)

  if (/^linear\s*\(/.test(v)) {
    const m = v.match(/linear\s*\(([^)]*)\)/)
    if (!m) return null
    const stops = parseLinearEasing(m[1])
    if (!stops || stops.length < 2) return null
    return sampleLinearStops(stops, clamp01(t))
  }
  return null
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t))
}

/** Built-in name OR exact-value lookup → the canonical value string. */
export function resolveBuiltin(value: string): string | null {
  const v = value.trim()
  const hit = BUILTIN_PRESETS.find((p) => p.name === v || p.value === v)
  return hit ? hit.value : null
}

/** Display name of a matching built-in ('ease-out'…), else null. */
export function builtinNameFor(value: string): string | null {
  const v = value.trim()
  return BUILTIN_PRESETS.find((p) => p.name === v || p.value === v)?.name ?? null
}

/** Piecewise-linear interpolation over parsed linear() stops. */
function sampleLinearStops(stops: LinearStop[], t: number): number {
  if (t <= stops[0].progress) return stops[0].position
  const last = stops[stops.length - 1]
  if (t >= last.progress) return last.position
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]
    if (t <= b.progress) {
      const a = stops[i - 1]
      const span = b.progress - a.progress || 1
      return a.position + ((b.position - a.position) * (t - a.progress)) / span
    }
  }
  return last.position
}

/**
 * Sample an easing into a polyline. Uniform samples are merged with the
 * actual stop progresses of linear() values so kinks land on real vertices
 * instead of being smoothed away. Returns null for unsupported values.
 */
export function sampleEasingPoints(value: string, samples = 24): CurvePoint[] | null {
  const v = value.trim()
  let extraTs: number[] = []
  if (/^linear\s*\(/.test(v)) {
    const m = v.match(/linear\s*\(([^)]*)\)/)
    const stops = m ? parseLinearEasing(m[1]) : null
    if (stops && stops.length >= 2) {
      const span = stops[stops.length - 1].progress || 1
      // Normalize against the last stop (same convention as the editor):
      // legacy strings whose percents don't reach 100% still span the width.
      extraTs = stops.map((s) => s.progress / span)
    }
  }
  const ts = [
    ...new Set([0, ...extraTs, ...Array.from({ length: samples + 1 }, (_, i) => i / samples), 1]),
  ]
    .filter((t) => t >= 0 && t <= 1)
    .sort((a, b) => a - b)
  const pts: CurvePoint[] = []
  for (const t of ts) {
    const val = sampleEasing(v, t)
    if (val === null || !Number.isFinite(val)) return null
    pts.push({ t, v: val })
  }
  return pts.length >= 2 ? pts : null
}

/**
 * Overshoot-aware vertical framing — THE shared y-scale semantics for all
 * easing thumbnails/glyphs (mirrors EasingEditor's control-point-based
 * `bezierYScale`: identity framing while the curve stays inside [0,1],
 * expands with margin when it leaves, never clamps).
 */
export function easingYExtent(pts: CurvePoint[]): { lo: number; hi: number } {
  let lo = 0
  let hi = 1
  for (const p of pts) {
    if (!Number.isFinite(p.v)) continue
    if (p.v < lo) lo = p.v
    if (p.v > hi) hi = p.v
  }
  return paddedExtent(lo, hi)
}

/** Add the shared 8% margin around a range that leaves [0,1]. */
export function paddedExtent(lo: number, hi: number): { lo: number; hi: number } {
  if (lo >= 0 && hi <= 1) return { lo: 0, hi: 1 }
  const margin = Math.max(hi - lo, 0.001) * 0.08
  return { lo: lo - margin, hi: hi + margin }
}

/**
 * Map sampled points to an SVG path string inside a w×h box (CSS px) with
 * `pad` breathing room, x left→right time, y up = larger eased value.
 */
export function curveToPathD(pts: CurvePoint[], w: number, h: number, pad = 2): string {
  const { lo, hi } = easingYExtent(pts)
  const innerW = Math.max(0.001, w - pad * 2)
  const innerH = Math.max(0.001, h - pad * 2)
  const fmt = (n: number) => +n.toFixed(2)
  return pts
    .map((p, i) => {
      const x = pad + p.t * innerW
      const y = pad + (1 - (p.v - lo) / (hi - lo)) * innerH
      return `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`
    })
    .join(' ')
}

/** Canonical cubic-bezier string from handles (3dp — matches round-trip). */
export function formatBezier(h: BezierHandles): string {
  return `cubic-bezier(${h.map((n) => +n.toFixed(3)).join(', ')})`
}
