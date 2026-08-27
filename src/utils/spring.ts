/**
 * Spring physics → linear() easing generator.
 *
 * Simulates a damped harmonic oscillator and samples its position curve
 * into an optimized `linear(...)` easing string — the only way to express
 * spring/bounce physics in pure CSS (Baseline Dec 2023).
 *
 * Two parameter models:
 *  - physical: stiffness, damping, mass (classic spring config)
 *  - perceptual: visualDuration (how long the movement appears to take)
 *    + bounce (0 = critically damped, 1 = very bouncy) — easier to design
 *    with; converted to physical params internally.
 */

export interface SpringConfig {
  stiffness: number // N/m-ish; higher = snappier
  damping: number // friction; higher = less oscillation
  mass: number // kg-ish
}

export interface PerceptualSpring {
  visualDurationMs: number // apparent settle time
  bounce: number // 0..1 (0 = no overshoot)
}

export function perceptualToConfig(p: PerceptualSpring): SpringConfig {
  const durationSec = Math.max(0.01, p.visualDurationMs / 1000)
  // Solve for stiffness/damping that produce the requested visual settle
  // time and overshoot. Standard approximations used by Motion et al.
  const bounce = Math.max(0, Math.min(1, p.bounce))
  const dampingRatio = 1 - bounce
  const omega0 = (2 * Math.PI) / durationSec / (0.8 + 0.4 * dampingRatio)
  const stiffness = omega0 * omega0
  const damping = 2 * dampingRatio * Math.sqrt(stiffness)
  return { stiffness, damping, mass: 1 }
}

/** Position of a unit step response at time t (seconds). 1 = settled. */
function samplePosition(t: number, c: SpringConfig): number {
  const { stiffness, damping, mass } = c
  const omega0 = Math.sqrt(stiffness / mass)
  const ratio = damping / (2 * mass)
  if (ratio < omega0) {
    // underdamped: oscillates before settling
    const omegaD = omega0 * Math.sqrt(1 - (ratio / omega0) ** 2)
    const envelope = Math.exp(-ratio * t)
    return 1 - envelope * (Math.cos(omegaD * t) + (ratio / omegaD) * Math.sin(omegaD * t))
  }
  // overdamped / critically damped: monotone approach
  const s1 = -ratio + Math.sqrt(Math.max(0, ratio * ratio - omega0 * omega0))
  const s2 = -ratio - Math.sqrt(Math.max(0, ratio * ratio - omega0 * omega0))
  if (s1 === s2) return 1 - (1 + Math.abs(s1) * t) * Math.exp(s1 * t)
  const w = (b: number) => (Math.exp(b * t) - 1) / (b * (s1 - s2))
  return 1 - (-s2 * w(-s1) + s1 * w(-s2))
}

/**
 * Public sampling helper — position (0..1, may overshoot) of a unit spring
 * step response at time `tSec`. Exposes the same physics that
 * `generateSpringLinear` plots, so UIs can render the curve directly.
 */
export function sampleSpring(config: SpringConfig, tSec: number): number {
  return samplePosition(tSec, config)
}

export interface SpringSampleOptions {
  /** Total simulated seconds (default: until settled within epsilon). */
  durationSec?: number
  /** Samples across the duration (default 50; more = smoother, bigger string). */
  samples?: number
}

const SETTLE_EPSILON = 0.001

export function settleTime(c: SpringConfig, maxSec = 10): number {
  const dt = 1 / 240
  let t = 0
  let prev = samplePosition(0, c)
  while (t < maxSec) {
    t += dt
    const pos = samplePosition(t, c)
    if (Math.abs(pos - 1) < SETTLE_EPSILON && Math.abs(pos - prev) < SETTLE_EPSILON / 10) {
      return t
    }
    prev = pos
  }
  return maxSec
}

/**
 * Generate a `linear(...)` CSS easing string from spring parameters.
 * The simulated settle window is mapped onto the full 0%..100% stop range
 * (so the easing spans whatever animation duration it is applied to).
 * Output positions may overshoot outside [0,1] (that's the point of springs).
 */
export function generateSpringLinear(
  config: SpringConfig,
  options: SpringSampleOptions = {},
): string {
  const total = options.durationSec ?? Math.min(settleTime(config) * 1.05, 10)
  const n = Math.max(12, options.samples ?? 50)
  const points: string[] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * total
    const v = samplePosition(t, config)
    const pct = ((i / n) * 100).toFixed(3).replace(/\.?0+$/, '') || '0'
    points.push(`${v.toFixed(4)} ${pct}%`)
  }
  // Explicit percents on every stop keep output stable across engines.
  return `linear(${points.join(', ')})`
}

export interface LinearStop {
  /** Eased value at the stop (may overshoot outside [0,1] for springs). */
  position: number
  /** Time progress of the stop, normalized to [0,1]. */
  progress: number
}

/**
 * Parse the stop list of a `linear(...)` easing into `{ position, progress }`
 * pairs (progress normalized to 0..1). Accepts the usual CSS forms:
 * `linear(0, 0.25 50%, 1)` — stops without an explicit `%` progress are
 * spaced evenly between their nearest specified neighbors. Returns null when
 * no valid stops are found.
 */
export function parseLinearEasing(body: string): LinearStop[] | null {
  const parts = body
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  const stops: LinearStop[] = []
  for (const part of parts) {
    const tokens = part.split(/\s+/)
    const position = Number.parseFloat(tokens[0])
    if (!Number.isFinite(position)) return null
    let progress = NaN
    if (tokens.length >= 2 && tokens[1].endsWith('%')) {
      progress = Number.parseFloat(tokens[1]) / 100
      if (!Number.isFinite(progress)) return null
    }
    stops.push({ position, progress })
  }
  if (!Number.isFinite(stops[0].progress)) stops[0].progress = 0
  if (!Number.isFinite(stops[stops.length - 1].progress)) {
    stops[stops.length - 1].progress = 1
  }
  // Fill remaining unspecified progresses: evenly spaced between the nearest
  // specified neighbors on either side.
  let lastKnown = 0
  while (lastKnown < stops.length) {
    let nextKnown = lastKnown + 1
    while (nextKnown < stops.length && !Number.isFinite(stops[nextKnown].progress)) nextKnown++
    const startP = stops[lastKnown].progress
    const endP = nextKnown < stops.length ? stops[nextKnown].progress : 1
    const steps = nextKnown - lastKnown
    for (let i = lastKnown + 1; i < nextKnown; i++) {
      stops[i].progress = startP + ((endP - startP) * (i - lastKnown)) / steps
    }
    lastKnown = nextKnown
  }
  return stops
}

export const SPRING_PRESETS: Record<string, { label: string; perceptual: PerceptualSpring }> = {
  gentle: { label: 'Gentle', perceptual: { visualDurationMs: 500, bounce: 0 } },
  snappy: { label: 'Snappy', perceptual: { visualDurationMs: 300, bounce: 0.15 } },
  bouncy: { label: 'Bouncy', perceptual: { visualDurationMs: 600, bounce: 0.45 } },
  elastic: { label: 'Elastic', perceptual: { visualDurationMs: 900, bounce: 0.7 } },
  materialEmphasized: {
    label: 'Material',
    perceptual: { visualDurationMs: 450, bounce: 0.22 },
  },
}

/** Pre-generated linear() values for each preset, for fast lookup. */
const _presetValues: { name: string; value: string }[] = Object.entries(SPRING_PRESETS).map(
  ([, p]) => ({
    name: p.label,
    value: generateSpringLinear(perceptualToConfig(p.perceptual)),
  }),
)

/**
 * Resolve a `linear(...)` easing string back to a spring preset name
 * (e.g. "Gentle", "Snappy") when the value matches a preset exactly.
 * Returns null if no preset matches.
 */
export function springPresetName(value: string): string | null {
  const t = value.trim()
  for (const p of _presetValues) {
    if (p.value === t) return p.name
  }
  return null
}
