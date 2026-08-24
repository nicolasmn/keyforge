import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { doc, selectedLayerId, showOrigins, setLayerOrigin } from '@/store'
import { slugify } from '@/utils/slugify'
import {
  clampPercent,
  originFromPointer,
  originPixelPoint,
  snapToPreset,
  type OriginResolveContext,
  type RectLike,
} from '@/utils/originMath'
import { originPicking, setOriginPicking } from './originPickState'

/**
 * Stage overlay for the transform-origin feature (plan §3/§4):
 *
 * - DEBUG VIEW: one token-styled SVG over the stage — per visible layer a
 *   dashed outline of the UN-transformed border box plus an origin crosshair
 *   + dot. Coordinates come from offsetLeft/Top/Width/Height: pre-transform
 *   LAYOUT values relative to offsetParent (.preview__canvas), immune BOTH to
 *   the ancestor --preview-scale scaling and to the element's own animated
 *   transform. getBoundingClientRect() of the TARGET is deliberately never
 *   used here — it would return the post-transform AABB (wrong anchor
 *   mid-animation).
 *
 * - PICK SURFACE: mounted only while "Pick on stage" mode is active and a
 *   measurable layer is selected. Click-to-place and drag-to-adjust are the
 *   same gesture (down = place, move = adjust, up = commit ONCE), mirroring
 *   the RotationDial commit-on-release contract (#68). Escape cancels a drag
 *   mid-gesture, or exits pick mode at rest.
 */

interface MeasuredBox extends RectLike {
  id: string
  fontSize: number
}

function cssEscapeId(slug: string): string {
  // Selector ids are slugified names; escape defensively so odd names can't
  // break querySelector. CSS.escape exists in every modern engine.
  return typeof CSS !== 'undefined' && 'escape' in CSS ? CSS.escape(slug) : slug
}

export default function OriginOverlay() {
  const [layoutVersion, bumpLayout] = createSignal(0)

  let surfaceEl: HTMLDivElement | undefined
  const [dragPreview, setDragPreview] = createSignal<{ x: number; y: number } | null>(null)
  let dragging = false
  let startClient = { x: 0, y: 0 }
  let startPoint = { x: 50, y: 50 }
  let axisLock: 'x' | 'y' | null = null

  // ── Measurement ────────────────────────────────────────────────────────
  // Signature that INCLUDES element data (the existing Preview.tsx memo
  // tracks only tracks/duration — plan §9 blind spot: never reuse it as the
  // debug-view trigger). boxes() re-measures when layers/element.origin/
  // selection change or the canvas resizes; offsets ignore transforms, so
  // playback does NOT trigger re-measurement (markers stay put while the
  // element animates around them — the pedagogical point).

  const selectedId = () => selectedLayerId()

  const layerSignature = createMemo(() =>
    JSON.stringify(
      doc.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        text: l.element.text ?? '',
        css: l.element.initialCss,
        o: l.element.origin ?? null,
      })),
    ),
  )

  const measuredBoxes = createMemo<MeasuredBox[]>(() => {
    layerSignature()
    layoutVersion()
    selectedId()
    const out: MeasuredBox[] = []
    for (const layer of doc.layers) {
      if (layer.visible === false) continue
      const el = document.querySelector<HTMLElement>(
        `[data-layer-id="${cssEscapeId(slugify(layer.name))}"]`,
      )
      // Defensive skips (plan §9): zero-size elements break %-math, and
      // position:fixed breaks the offsetParent chain (offsets become
      // viewport-relative). Neither gets markers nor picking.
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) continue
      try {
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed') continue
      } catch {
        continue // detached element
      }
      out.push({
        id: layer.id,
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
        fontSize: Number.parseFloat(getComputedStyle(el).fontSize) || 16,
      })
    }
    return out
  })

  const resolveCtx = (fontSize: number): OriginResolveContext => ({
    fontSize,
    rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
  })

  const targetBox = createMemo(() => measuredBoxes().find((b) => b.id === selectedId()))

  // Canvas layout-box changes (mobile full-bleed sizing, initialCss size
  // edits, viewport resizes affecting vw/vh units) must re-measure even
  // though no store field changed. Panel resizes only change --preview-scale,
  // which offsets are immune to — bumping anyway is cheap and harmless.
  createEffect(() => {
    const canvas = surfaceEl?.parentElement
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => bumpLayout((v) => v + 1))
    observer.observe(canvas)
    const onWinResize = () => bumpLayout((v) => v + 1)
    window.addEventListener('resize', onWinResize)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener('resize', onWinResize)
    })
  })

  // ── Shown geometry ─────────────────────────────────────────────────────
  // Mid-drag the local preview wins (zero store writes); at rest we render
  // the committed origin, defaulting to center (50% 50%) when unset.

  /** Shown origin expressed in percentages along the target's axes. */
  const shownPct = () => {
    const t = targetBox()
    if (!t) return null
    const d = dragPreview()
    if (d) return d
    const pt = originPixelPoint(
      {
        x: doc.layers.find((l) => l.id === selectedId())?.element.origin?.x ?? '50%',
        y: doc.layers.find((l) => l.id === selectedId())?.element.origin?.y ?? '50%',
      },
      t,
      resolveCtx(t.fontSize),
    )
    return {
      x: clampPercent(((pt.x - t.left) / t.width) * 100),
      y: clampPercent(((pt.y - t.top) / t.height) * 100),
    }
  }

  const handlePos = () => {
    const t = targetBox()
    const pct = shownPct()
    if (!t || !pct) return null
    return { px: t.left + (pct.x / 100) * t.width, py: t.top + (pct.y / 100) * t.height, ...pct }
  }

  // ── Gesture (RotationDial contract, plan §3) ───────────────────────────

  /** Pointer → percentages via overlay-rect ratio (scale-invariant). Measures
   *  the SURFACE rect — never the target element's bounding rect. */
  function rawPct(e: PointerEvent): { x: number; y: number } {
    const rect = surfaceEl!.getBoundingClientRect()
    const p = originFromPointer(e.clientX, e.clientY, rect)
    return { x: Number.parseFloat(p.x), y: Number.parseFloat(p.y) }
  }

  function startGesture(e: PointerEvent) {
    if (!selectedId() || !targetBox()) return
    e.preventDefault()
    dragging = true
    axisLock = null
    startClient = { x: e.clientX, y: e.clientY }
    startPoint = rawPct(e)
    setDragPreview(startPoint) // preview only — NO store write yet
    try {
      surfaceEl!.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events may not support capture */
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    e.preventDefault()
    let next = rawPct(e)
    // Shift constrains to the dominant axis (locked once movement resolves).
    if (e.shiftKey) {
      if (!axisLock) {
        const dx = Math.abs(e.clientX - startClient.x)
        const dy = Math.abs(e.clientY - startClient.y)
        if (dx > 2 || dy > 2) axisLock = dx >= dy ? 'x' : 'y'
      }
      if (axisLock === 'x') next.y = startPoint.y
      else if (axisLock === 'y') next.x = startPoint.x
    } else {
      axisLock = null
    }
    // Magnet: within ~2% of a grid preset point, snap to it.
    const magnet = snapToPreset(next.x, next.y)
    if (magnet) next = { x: magnet.x, y: magnet.y }
    setDragPreview(next)
  }

  function cancelDrag() {
    if (!dragging) return
    dragging = false
    setDragPreview(null) // discard preview → prior origin restored
  }

  /** End of gesture. Commits the final previewed position exactly once. */
  function endDrag(commit: boolean) {
    if (!dragging) return
    dragging = false
    const final = dragPreview()
    setDragPreview(null)
    const sel = selectedId()
    if (commit && final && sel) setLayerOrigin(sel, `${final.x}%`, `${final.y}%`)
  }

  // Escape mid-drag cancels; Escape at rest exits pick mode entirely.
  createEffect(() => {
    if (!originPicking()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (dragging) cancelDrag()
      else setOriginPicking(false)
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  // ── Handle keyboard (role="slider") ────────────────────────────────────
  // Arrows nudge ±1%, Shift+arrows ±5% (task spec); nudges commit immediately
  // like RotationDial keyboard input. Nudged values store as percentages —
  // % is the picker's native space and keeps exported decls uniform.

  function onKeyDown(e: KeyboardEvent) {
    const cur = shownPct()
    const sel = selectedId()
    if (!cur || !sel) return
    const step = e.shiftKey ? 5 : 1
    let { x, y } = cur
    if (e.key === 'ArrowLeft') x -= step
    else if (e.key === 'ArrowRight') x += step
    else if (e.key === 'ArrowUp') y -= step
    else if (e.key === 'ArrowDown') y += step
    else return
    e.preventDefault()
    e.stopPropagation()
    setLayerOrigin(sel, `${clampPercent(x)}%`, `${clampPercent(y)}%`)
  }

  const fmt1dp = (n: number) => String(clampPercent(n))

  return (
    <>
      {/* Debug view: ghost outlines + origin crosshairs. Always
          pointer-events:none; renders regardless of the toggle while pick
          mode is active (plan §4). */}
      <Show when={showOrigins() || originPicking()}>
        <svg class="kf-origin-debug" aria-hidden="true">
          <For each={measuredBoxes()}>
            {(b) => (
              <g opacity={b.id === selectedId() ? 1 : 0.5}>
                <rect
                  class="kf-origin-debug__ghost"
                  classList={{ 'kf-origin-debug__ghost--sel': b.id === selectedId() }}
                  x={b.left}
                  y={b.top}
                  width={b.width}
                  height={b.height}
                />
                {(() => {
                  const layer = doc.layers.find((l) => l.id === b.id)
                  const pt = originPixelPoint(
                    { x: layer?.element.origin?.x ?? '50%', y: layer?.element.origin?.y ?? '50%' },
                    b,
                    resolveCtx(b.fontSize),
                  )
                  return (
                    <>
                      <line
                        class="kf-origin-debug__cross"
                        x1={b.left}
                        y1={pt.y}
                        x2={b.left + b.width}
                        y2={pt.y}
                      />
                      <line
                        class="kf-origin-debug__cross"
                        x1={pt.x}
                        y1={b.top}
                        x2={pt.x}
                        y2={b.top + b.height}
                      />
                      <circle class="kf-origin-debug__dot" cx={pt.x} cy={pt.y} r="3" />
                    </>
                  )
                })()}
              </g>
            )}
          </For>
        </svg>
      </Show>

      {/* Pick surface: click-to-place / drag-to-adjust, pick mode only.
          pointer-events:auto ONLY here; the SVG above stays inert. */}
      <Show when={originPicking() && !!targetBox()}>
        <div
          ref={(el) => {
            surfaceEl = el
          }}
          class="kf-origin-pick"
          onPointerDown={startGesture}
          onPointerMove={onPointerMove}
          onPointerUp={() => endDrag(true)}
          onLostPointerCapture={() => endDrag(true)}
        >
          <Show when={handlePos()}>
            {(h) => (
              <div
                class="kf-origin-handle"
                role="slider"
                tabindex={0}
                aria-label="Transform origin"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(h().x)}
                aria-valuetext={`origin ${fmt1dp(h().x)}%, ${fmt1dp(h().y)}%`}
                aria-describedby="kf-origin-slider-hint"
                style={{ left: `${h().px}px`, top: `${h().py}px` }}
                onKeyDown={onKeyDown}
              >
                <span class="kf-origin-handle__glyph">✛</span>
              </div>
            )}
          </Show>
        </div>
        {/* Screen-reader hint for the 2-axis slider (a11y review note, plan §3:
            the fully accessible path is the Inspector inputs + preset grid). */}
        <span id="kf-origin-slider-hint" class="kf-sr-only">
          Arrow keys move X with Left and Right, Y with Up and Down. Hold Shift for 5 percent steps.
        </span>
      </Show>
    </>
  )
}
