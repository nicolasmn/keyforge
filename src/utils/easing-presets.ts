export interface EasingPreset {
  name: string
  value: string
}

export const EASING_PRESETS: EasingPreset[] = [
  { name: 'linear',           value: 'linear' },
  { name: 'ease',             value: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
  { name: 'ease-in',          value: 'cubic-bezier(0.42, 0, 1, 1)' },
  { name: 'ease-out',         value: 'cubic-bezier(0, 0, 0.58, 1)' },
  { name: 'ease-in-out',      value: 'cubic-bezier(0.42, 0, 0.58, 1)' },
  { name: 'ease-in-quad',     value: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)' },
  { name: 'ease-out-quad',    value: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' },
  { name: 'ease-in-out-quad', value: 'cubic-bezier(0.455, 0.03, 0.515, 0.955)' },
  { name: 'ease-in-cubic',    value: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)' },
  { name: 'ease-out-cubic',   value: 'cubic-bezier(0.215, 0.61, 0.355, 1)' },
  { name: 'ease-in-out-cubic',value: 'cubic-bezier(0.645, 0.045, 0.355, 1)' },
  { name: 'ease-in-back',     value: 'cubic-bezier(0.6, -0.28, 0.735, 0.045)' },
  { name: 'ease-out-back',    value: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' },
  { name: 'ease-in-out-back', value: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)' },
]

export function parseCubicBezier(value: string): [number, number, number, number] | null {
  const m = value.match(/cubic-bezier\(\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\s*\)/)
  if (!m) return null
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]
}

/** Evaluate cubic bezier at t using standard parameterization */
export function evalCubicBezier(
  t: number,
  [x1, y1, x2, y2]: [number, number, number, number],
): number {
  // Newton-Raphson to find s for given t (x-axis), then compute y
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by

  function sampleX(s: number) { return ((ax * s + bx) * s + cx) * s }
  function sampleY(s: number) { return ((ay * s + by) * s + cy) * s }
  function sampleDX(s: number) { return (3 * ax * s + 2 * bx) * s + cx }

  let s = t
  for (let i = 0; i < 8; i++) {
    const dx = sampleX(s) - t
    if (Math.abs(dx) < 1e-7) break
    s -= dx / sampleDX(s)
  }
  return sampleY(s)
}
