/**
 * Ruler scale math — pure functions, no Solid coupling, canvas-independent
 * (the text measurer is injected) so they unit-test in node.
 *
 * Adaptive density goal: fixed-width windows keep today's look (~duration/10
 * majors); wide windows reveal finer granularity down to every millisecond,
 * with no label collisions anywhere in between.
 */

/** Nice-number ladder: 1-2-5 per decade, ms units, capped at duration/2. */
export function candidateSteps(duration: number): number[] {
  if (!Number.isFinite(duration) || duration < 2) return []
  const steps: number[] = []
  for (let d = 1; d <= duration; d *= 10) {
    for (const m of [1, 2, 5]) {
      const s = d * m
      if (s <= duration / 2) steps.push(Math.round(s))
    }
  }
  return steps.reverse() // coarse → fine
}

/**
 * Label for a major tick at time `t`, switching unit by magnitude so widths
 * stay predictable in monospace: sub-second reads "200ms", above reads
 * seconds with decimals matched to the step's precision.
 */
export function formatTick(t: number, step: number): string {
  if (t < 1000) return `${Math.round(t)}ms`
  const decimals = step < 10 ? 3 : step < 100 ? 2 : 1
  return `${(t / 1000).toFixed(decimals)}s`
}

/**
 * Smallest nice step whose labels cannot collide.
 *
 * @param duration      document length in ms (> 0)
 * @param laneWidthPx   usable lane width in CSS px (excludes label gutter + duration handle)
 * @param gapPx         breathing room required after each label (recommend 12–14)
 * @param minStepPx     ticks closer than this many CSS px read as noise
 * @param measure       rendered px width of a label at the current font
 *                      (call inside draw() AFTER ctx.font is set)
 * @returns the chosen label step in ms; never coarser than duration/10,
 *          never finer than 1 ms.
 */
export function chooseLabelStep(
  duration: number,
  laneWidthPx: number,
  gapPx: number,
  minStepPx: number,
  measure: (label: string) => number,
): number {
  const baseline = duration / 10 // today's density floor — never coarser
  if (!Number.isFinite(duration) || !Number.isFinite(laneWidthPx) || duration <= 0) return baseline
  const pxPerMs = laneWidthPx / duration
  let best = baseline
  for (const s of candidateSteps(duration)) {
    if (s < 1) break // never finer than 1 ms
    if (s > baseline) continue // never coarser than shipped density
    const requiredPx = measure(formatTick(duration, s)) + gapPx
    const maxLabels = Math.floor(laneWidthPx / requiredPx)
    const intervals = Math.floor(duration / s) + 1
    const spacingOk = s * pxPerMs >= minStepPx
    if (intervals <= maxLabels && spacingOk) {
      best = Math.min(best, s)
    } else {
      break // candidates are monotone in strictness: first failure ends it
    }
  }
  return best
}

/**
 * Minor-tick interval for a given label step: a fifth of it, falling back
 * to a half when fifths would sit closer than `minGapPx` apart.
 */
export function minorStepFor(labelStep: number, pxPerMs: number, minGapPx = 4): number {
  let minor = labelStep / 5
  if (minor * pxPerMs < minGapPx) minor = labelStep / 2
  return minor
}

/** Largest multiple of `step` not exceeding `duration` (last labeled major). */
export function lastMajorTime(duration: number, step: number): number {
  return Math.floor(duration / step) * step
}
