/**
 * EasingCurveChip — the shared mini-curve SVG thumbnail (plan §3).
 *
 * One renderer for every read-only easing surface: inspector row chips,
 * the popover's preset grid, and saved-library entries. Sampling goes
 * through utils/easingCurve (evalCubicBezier + linear() stops), framing
 * through easingYExtent so overshoot curves keep their true shape —
 * `anticipate` visibly dips, `overshoot`/`settle` visibly crest.
 * Unsupported values (steps() until L4) degrade to a straight line.
 */
import { createMemo } from 'solid-js'
import { sampleEasingPoints, curveToPathD } from '@/utils/easingCurve'

export function EasingCurveChip(props: { value: string; width?: number; height?: number }) {
  const w = () => props.width ?? 30
  const h = () => props.height ?? 16
  const d = createMemo(() => {
    const pts = sampleEasingPoints(props.value, 24)
    // Straight-line fallback for steps()/unknown — honest "no curve info"
    // rather than a fabricated shape (plan §8: unknown → null → line).
    return pts ? curveToPathD(pts, w(), h(), 2) : `M${w() - 2} ${h() - 2} L2 2`
  })
  return (
    <svg
      class="kf-ease-thumb"
      width={w()}
      height={h()}
      viewBox={`0 0 ${w()} ${h()}`}
      aria-hidden="true"
    >
      <path d={d()} />
    </svg>
  )
}
