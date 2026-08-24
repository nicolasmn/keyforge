/**
 * SplitLayout — wires Split.js into the desktop app shell.
 *
 * Two split instances:
 *   1. Horizontal: Preview | Inspector
 *   2. Vertical:   top workspace | Timeline area
 *
 * Split.js mutates element widths/heights directly via inline styles.
 * We give it DOM refs after mount; onCleanup destroys both instances.
 *
 * Double-click any gutter → resets that split to default sizes.
 *
 * Audit F14: Split.js only enforces minSize/maxSize while dragging, so panel
 * proportions drift out of bounds whenever the viewport changes size (e.g.
 * the 400px-capped inspector measures 497px at 1920×1080 with default sizes).
 * We re-clamp on window resize by reading the current percentages, converting
 * them to px against the live container box, clamping/redistributing via
 * `clampPanelPixels`, and writing back through setSizes. The same path runs
 * once at mount (defaults can violate caps on wide viewports) and after a
 * double-click reset.
 */
import { onMount, onCleanup, type JSX } from 'solid-js'
import Split from 'split.js'

interface Props {
  preview: JSX.Element
  inspector: JSX.Element
  timelineArea: JSX.Element
}

type SplitInstance = ReturnType<typeof Split>

function makeGutter(direction: 'horizontal' | 'vertical'): HTMLElement {
  const g = document.createElement('div')
  g.className = `gutter gutter--${direction}`
  return g
}

/** Gutter thickness — keep in sync with the `gutterSize` option below. */
const GUTTER_PX = 4

// Horizontal split: Preview | Inspector
const H_DEFAULT_PCT = [68, 32]
const H_MIN_PX = [300, 220]
const H_MAX_PX = [Infinity, 400]

// Vertical split: workspace | Timeline
const V_DEFAULT_PCT = [70, 30]
const V_MIN_PX = [200, 120]
const V_MAX_PX = (): number[] => [Infinity, Math.round(window.innerHeight * 0.5)]

/**
 * Clamp desired pixel widths into each panel's [min, max] window while making
 * the total exactly `availablePx`, redistributing any surplus/deficit across
 * panels that still have headroom (proportional to their current size).
 *
 * Pure so it stays unit-testable; all inputs/outputs are pixels.
 *
 * Degenerate case: when available space is smaller than Σ(min) no feasible
 * layout exists — returns every panel at its minimum and lets the container
 * scroll/overflow rather than dropping below a usable size.
 */
export function clampPanelPixels(
  desiredPx: number[],
  minPx: number[],
  maxPx: number[],
  availablePx: number,
): number[] {
  const count = desiredPx.length
  const result = new Array<number>(count)

  // Pass 1 — hard-clamp each panel into its own bounds.
  for (let i = 0; i < count; i++) {
    const desired = Number.isFinite(desiredPx[i]) ? desiredPx[i] : minPx[i]
    const max = Number.isFinite(maxPx[i]) ? maxPx[i] : Infinity
    result[i] = Math.min(Math.max(desired, minPx[i]), max)
  }

  // Pass 2 — absorb the difference between clamped total and available space.
  const EPSILON = 0.01
  for (let pass = 0; pass < count * 2 + 2; pass++) {
    let total = 0
    for (const v of result) total += v
    const delta = availablePx - total
    if (Math.abs(delta) <= EPSILON) break

    let flexibleTotal = 0
    const flexible: number[] = []
    for (let i = 0; i < count; i++) {
      const canGrow = delta > 0 && result[i] < maxPx[i] - EPSILON
      const canShrink = delta < 0 && result[i] > minPx[i] + EPSILON
      if (canGrow || canShrink) {
        flexible.push(i)
        flexibleTotal += result[i]
      }
    }
    if (flexible.length === 0) break

    for (const i of flexible) {
      const share =
        flexibleTotal > EPSILON ? delta * (result[i] / flexibleTotal) : delta / flexible.length
      const max = Number.isFinite(maxPx[i]) ? maxPx[i] : Infinity
      result[i] = Math.min(Math.max(result[i] + share, minPx[i]), max)
    }
  }

  return result
}

/**
 * Re-clamp a split instance's current sizes to its min/max px constraints
 * against the container's live client box (audit F14).
 */
function reclampSplit(
  splitInstance: SplitInstance,
  containerEl: HTMLElement,
  minPx: number[],
  maxPx: number[],
): void {
  const availablePx = containerEl.clientWidth - (minPx.length - 1) * GUTTER_PX
  if (!Number.isFinite(availablePx) || availablePx <= 0) return

  const currentPct = splitInstance.getSizes()
  if (currentPct.length !== minPx.length) return

  const desiredPx = currentPct.map((pct) => (pct / 100) * availablePx)
  const clampedPx = clampPanelPixels(desiredPx, minPx, maxPx, availablePx)

  // Percentages are resolved against the full container width, but Split.js
  // subtracts the gutter allowance per element, so they must sum to 100 over
  // the gutter-free space — which clampPanelPixels guarantees.
  splitInstance.setSizes(clampedPx.map((px) => (px / availablePx) * 100))
}

export default function SplitLayout(props: Props) {
  let topRowRef!: HTMLDivElement
  let previewRef!: HTMLDivElement
  let inspectorRef!: HTMLDivElement
  let timelineRef!: HTMLDivElement
  let shellRef!: HTMLDivElement

  onMount(() => {
    const hSplit = Split([previewRef, inspectorRef], {
      sizes: H_DEFAULT_PCT,
      minSize: H_MIN_PX,
      maxSize: H_MAX_PX,
      gutterSize: GUTTER_PX,
      snapOffset: 0,
      direction: 'horizontal',
      cursor: 'col-resize',
      gutter(_index, direction) {
        return makeGutter(direction)
      },
    })

    const vSplit = Split([topRowRef, timelineRef], {
      sizes: V_DEFAULT_PCT,
      minSize: V_MIN_PX,
      maxSize: V_MAX_PX(),
      gutterSize: GUTTER_PX,
      snapOffset: 0,
      direction: 'vertical',
      cursor: 'row-resize',
      gutter(_index, direction) {
        return makeGutter(direction)
      },
    })

    const reclampAll = () => {
      reclampSplit(hSplit, topRowRef, H_MIN_PX, H_MAX_PX)
      // Recompute the timeline cap from the live viewport height so it stays
      // correct after window resizes too (same drag-time-only staleness).
      reclampSplit(vSplit, shellRef, V_MIN_PX, V_MAX_PX())
    }

    // Fix out-of-bounds defaults immediately (e.g. 26% inspector > 400px at
    // 1920×1080), then again whenever the viewport changes.
    reclampAll()

    let resizeRaf = 0
    const onWindowResize = () => {
      cancelAnimationFrame(resizeRaf)
      resizeRaf = requestAnimationFrame(reclampAll)
    }
    window.addEventListener('resize', onWindowResize)

    document.querySelectorAll<HTMLElement>('.gutter--horizontal').forEach((g) => {
      g.addEventListener('dblclick', () => {
        hSplit.setSizes(H_DEFAULT_PCT)
        reclampSplit(hSplit, topRowRef, H_MIN_PX, H_MAX_PX)
      })
    })
    document.querySelectorAll<HTMLElement>('.gutter--vertical').forEach((g) => {
      g.addEventListener('dblclick', () => {
        vSplit.setSizes(V_DEFAULT_PCT)
        reclampSplit(vSplit, shellRef, V_MIN_PX, V_MAX_PX())
      })
    })

    onCleanup(() => {
      cancelAnimationFrame(resizeRaf)
      window.removeEventListener('resize', onWindowResize)
      hSplit.destroy()
      vSplit.destroy()
    })
  })

  return (
    <div class="split-shell" ref={shellRef}>
      <div class="split-top-row" ref={topRowRef}>
        <div class="split-panel split-panel--preview" ref={previewRef}>
          {props.preview}
        </div>
        <div class="split-panel split-panel--inspector" ref={inspectorRef}>
          {props.inspector}
        </div>
      </div>
      <div class="split-panel split-panel--timeline" ref={timelineRef}>
        {props.timelineArea}
      </div>
    </div>
  )
}
