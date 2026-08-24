export interface EasingPreset {
  name: string
  value: string
}

/** Built-in read-only presets — never mutated. */
export const BUILTIN_PRESETS: EasingPreset[] = [
  { name: 'linear', value: 'linear' },
  { name: 'ease', value: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
  { name: 'ease-in', value: 'cubic-bezier(0.42, 0, 1, 1)' },
  { name: 'ease-out', value: 'cubic-bezier(0, 0, 0.58, 1)' },
  { name: 'ease-in-out', value: 'cubic-bezier(0.42, 0, 0.58, 1)' },
  { name: 'ease-in-quad', value: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)' },
  { name: 'ease-out-quad', value: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' },
  { name: 'ease-in-out-quad', value: 'cubic-bezier(0.455, 0.03, 0.515, 0.955)' },
  { name: 'ease-in-cubic', value: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)' },
  { name: 'ease-out-cubic', value: 'cubic-bezier(0.215, 0.61, 0.355, 1)' },
  { name: 'ease-in-out-cubic', value: 'cubic-bezier(0.645, 0.045, 0.355, 1)' },
  { name: 'ease-in-back', value: 'cubic-bezier(0.6, -0.28, 0.735, 0.045)' },
  { name: 'ease-out-back', value: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' },
  { name: 'ease-in-out-back', value: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)' },
  // Overshoot family (plan §3.4): control-point Y outside [0,1] is
  // spec-valid CSS — only X must stay in [0,1]. These encode AE-style
  // anticipation (wind-up dip below the start) and overshoot/settle
  // (pass the target, come back) in ONE cubic-bezier segment.
  // Extremes (verified numerically): anticipate dips to ≈−0.12 at ~24%
  // progress; overshoot peaks at ≈+1.10 around 57%; settle peaks gently
  // at ≈+1.04 around 53% with a long settle tail.
  { name: 'anticipate', value: 'cubic-bezier(0.68, -0.55, 0.265, 1)' },
  { name: 'overshoot', value: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  { name: 'settle', value: 'cubic-bezier(0.22, 1.36, 0.44, 1)' },
]

/** @deprecated use BUILTIN_PRESETS */
export const EASING_PRESETS = BUILTIN_PRESETS

export function parseCubicBezier(value: string): [number, number, number, number] | null {
  const m = value.match(/cubic-bezier\(\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\s*\)/)
  if (!m) return null
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]
}

/**
 * Evaluate cubic bezier Y at progress t (0..1), solving x(s)=t for the
 * parameter s first. Control-point Y may lie outside [0,1] (overshoot/
 * anticipation) — only X participates in the solve, and since X control
 * points stay within [0,1], x(s) is monotone so the solution is unique.
 *
 * Solver: Newton-Raphson (fast, usually converges in 2–3 iterations)
 * with a bisection fallback for extreme curves where Newton stalls or
 * jumps outside [0,1] — e.g. strong anticipation handles. Guarantees
 * |x(s)−t| < 1e-7 whenever the curve is well-conditioned.
 */
export function evalCubicBezier(
  t: number,
  [x1, y1, x2, y2]: [number, number, number, number],
): number {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by
  function sampleX(s: number) {
    return ((ax * s + bx) * s + cx) * s
  }
  function sampleY(s: number) {
    return ((ay * s + by) * s + cy) * s
  }
  function sampleDX(s: number) {
    return (3 * ax * s + 2 * bx) * s + cx
  }
  const EPSILON = 1e-7
  let s = t
  let solved = false
  if (t <= 0) {
    solved = true
    s = 0
  } else if (t >= 1) {
    solved = true
    s = 1
  } else {
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(s) - t
      if (Math.abs(dx) < EPSILON) {
        solved = true
        break
      }
      const d = sampleDX(s)
      if (Math.abs(d) < 1e-6) break // Newton stalled — fall through to bisection
      s -= dx / d
      // A Newton step that escapes [0,1] can never come back usefully.
      if (s < 0 || s > 1) break
    }
  }
  if (!solved) {
    // Bisection: x(s) is monotone in s, so a bracket always exists.
    let lo = 0
    let hi = 1
    s = t
    while (hi - lo > EPSILON) {
      const mid = (lo + hi) / 2
      if (sampleX(mid) < t) lo = mid
      else hi = mid
    }
    s = (lo + hi) / 2
  }
  return sampleY(s)
}
