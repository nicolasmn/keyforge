import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  applyGizmoEdit,
  doc,
  playhead,
  removeKeyframe,
  removeTrack,
  selectedLayerId,
  setPlaying,
  updateKeyframe,
  type GizmoEditReceipt,
} from '@/store'
import { originPicking } from './originPickState'
import { slugify } from '@/utils/slugify'
import { interpolatedValueAt } from '@/utils/interpolate'
import {
  applyPoseToBox,
  clampScale,
  CORNER_HIT_PX,
  cursorForPart,
  formatRotateDeg,
  formatScaleNum,
  formatTranslate,
  hitTestGizmoPosed,
  moveDelta,
  parseRotateDeg,
  parseScaleNum,
  parseTranslatePair,
  pointerAngleRad,
  resolvePivot,
  rotationDelta,
  ROTATE_HANDLE_R,
  scaleFactor,
  snapRotationToStep,
  toLayoutPoint,
  type GizmoPart,
  type GizmoSpace,
  type Point,
  type PosedGizmoGeometry,
} from '@/utils/gizmoMath'
import type { RectLike } from '@/utils/originMath'
import type { AnimatableProperty, Track } from '@/types'

/**
 * Stage overlay for transform gizmos (transform gizmos plan §3/§7 Phase 1):
 *
 * An SVG layer inside .preview__canvas drawing the SELECTED layer's
 * UN-transformed reference box (offsetLeft/Top/Width/Height — immune to
 * --preview-scale AND to the element's own animated WAAPI transform;
 * getBoundingClientRect of the target is never read), plus:
 *   - 4 corner handles → uniform scale (24px targets, 12px glyphs)
 *   - rotation handle above the top edge on a stem
 *   - body drag → translate
 *
 * Owner-approved defaults (2026-08-25):
 *   auto-key always on · individual properties only · HOVER-GATED visibility
 *   (the gizmo shows while the pointer hovers the selected layer's area and
 *   STAYS visible for the duration of an active gesture even if the pointer
 *   briefly leaves; no always-on box) · no spatial snapping · corners only.
 *
 * Layers whose motion lives ONLY in a composite `transform` track render the
 * muted "composite — edit in inspector" badge with inert handles (Phase 3
 * maps drags onto transformStack functions).
 *
 * Gesture architecture mirrors Inspector's module-scope chip-scrub session:
 * exactly one gesture lives at MODULE scope, so rAF-throttled store writes
 * re-rendering the tree can never strand a running drag. Events are
 * delegated to .preview__canvas itself (the SVG is pointer-events:none so
 * stage clicks keep flowing); pointerdown hit-tests against the same pure
 * geometry that drives hover (utils/gizmoMath.hitTestGizmo). Origin pick
 * mode wins: while originPicking() is true the gizmo suppresses entirely.
 */

// ── Module-scope reactive state ───────────────────────────────────────

/** Affordance under the pointer at rest (also the hover gate). */
const [hoverPart, setHoverPart] = createSignal<GizmoPart | null>(null)
/** Non-null while a gesture owns visibility + input (survives remounts). */
const [gestureKind, setGestureKind] = createSignal<'move' | 'rotate' | 'scale' | null>(null)
/** Value chip following the cursor during gestures (canvas-layout px). */
const [chip, setChip] = createSignal<{ x: number; y: number; text: string } | null>(null)

interface GizmoSession {
  pointerId: number
  kind: 'move' | 'rotate' | 'scale'
  property: AnimatableProperty
  layerId: string
  /** Frozen measurement space captured at grab. */
  space: GizmoSpace
  /** Pointer position at grab (client px + layout px). */
  startClient: Point
  startLayout: Point
  /** Reference box frozen at grab (canvas-layout px). */
  box: RectLike
  /** Rotation/scale pivot resolved at grab (canvas-layout px). */
  pivot: Point
  /** Start pose parsed from interpolatedValueAt(track, playheadMs). */
  startTranslate: { x: number; y: number }
  startRotDeg: number
  startScale: number
  /** Rotate-only: pointer ray angle around the pivot at grab. */
  startAngleRad: number
  /** Scale-only: pivot→grab distance. */
  startDist: number
  playheadMs: number
  /** Latest computed canonical value, applied ≤1× per animation frame. */
  latest: string | null
  raf: number
  /** Structural receipts for Esc-cancel reversal. */
  receipts: GizmoEditReceipt[]
  lastClient: Point
}

let session: GizmoSession | null = null

const GIZMO_PROPERTIES: Record<GizmoSession['kind'], AnimatableProperty> = {
  move: 'translate',
  rotate: 'rotate',
  scale: 'scale',
}

export default function TransformOverlay() {
  let containerEl: HTMLDivElement | undefined
  const [canvasRef, setCanvasRef] = createSignal<HTMLDivElement | null>(null)
  const [layoutVersion, bumpLayout] = createSignal(0)

  // ── Measurement (OriginOverlay discipline) ──────────────────────────
  // Signature includes element data but NOT tracks: track writes stream in
  // every frame of a drag and offsets ignore transforms, so re-measuring
  // per frame would be pure waste. Canvas/window resizes bump layoutVersion.

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

  const targetBox = createMemo<RectLike | null>(() => {
    layerSignature()
    layoutVersion()
    const id = selectedLayerId()
    if (!id) return null
    const layer = doc.layers.find((l) => l.id === id)
    if (!layer || layer.visible === false) return null
    // Selector ids are slugified names; escape defensively (OriginOverlay).
    const sel =
      typeof CSS !== 'undefined' && 'escape' in CSS
        ? CSS.escape(slugify(layer.name))
        : slugify(layer.name)
    const el = document.querySelector<HTMLElement>(`[data-layer-id="${sel}"]`)
    // Defensive skips (plan §9): zero-size elements break %-math and scale
    // math; position:fixed breaks the offsetParent chain.
    if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return null
    try {
      if (getComputedStyle(el).position === 'fixed') return null
    } catch {
      return null // detached element
    }
    return {
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }
  })

  const selectedLayer = () => doc.layers.find((l) => l.id === selectedLayerId())

  /** Composite-only layers: badge + inert handles (plan §2 precedence). */
  const compositeOnly = createMemo(() => {
    const layer = selectedLayer()
    if (!layer) return false
    const hasTransform = layer.tracks.some((t) => t.property === 'transform')
    const hasIndividual = ['translate', 'rotate', 'scale'].some((p) =>
      layer.tracks.some((t) => t.property === p),
    )
    return hasTransform && !hasIndividual
  })

  /** HOVER-GATED visibility; a live gesture pins it until pointerup/Esc. */
  const visible = () =>
    !!targetBox() && !originPicking() && (hoverPart() !== null || gestureKind() !== null)

  // ── Animated pose → posed geometry (owner feedback 2026-08-25) ──────
  // Handles must sit ON the transformed element: compose the current
  // playhead pose (interpolatedValueAt per property) over the reference
  // box. Reactive to playhead AND track writes — during a drag the
  // streamed auto-key writes update this memo, so the overlay follows its
  // own edits with no extra plumbing.
  const pose = createMemo(() => {
    const phMs = Math.round(playhead())
    const t = parseTranslatePair(poseAt('translate', phMs) ?? '0px 0px')
    return {
      tx: t.x,
      ty: t.y,
      rotDeg: parseRotateDeg(poseAt('rotate', phMs) ?? '0deg'),
      scale: parseScaleNum(poseAt('scale', phMs) ?? '1'),
    }
  })

  const posedGeo = createMemo<PosedGizmoGeometry | null>(() => {
    const box = targetBox()
    if (!box) return null
    const layer = selectedLayer()
    const pct = resolvePivot({ element: { origin: layer?.element.origin } }, null, box)
    return applyPoseToBox(box, pose(), { xPct: pct.xPct, yPct: pct.yPct })
  })

  // Canvas resize / window resize must re-measure offsets even though no
  // store field changed (same trigger set as OriginOverlay's debug view;
  // panel resizes only change --preview-scale, which offsets ignore, but
  // bumping anyway is cheap and covers full-bleed mobile sizing).
  createEffect(() => {
    const canvas = canvasRef()
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

  // ── Geometry helpers ────────────────────────────────────────────────

  function liveSpace(): GizmoSpace | null {
    const c = canvasRef()
    if (!c) return null
    return {
      rect: c.getBoundingClientRect(),
      layoutWidth: c.offsetWidth,
      layoutHeight: c.offsetHeight,
    }
  }

  function layoutPointFrom(e: { clientX: number; clientY: number }, space: GizmoSpace): Point {
    return toLayoutPoint(space, e.clientX, e.clientY)
  }

  /**
   * Pivot in canvas-layout px (plan §2 chain). No origin TRACKS exist in
   * today's data model (PR #102 shipped static structured origins); pass
   * null and let resolvePivot own the precedence chain end-to-end.
   */
  function pivotFor(
    layer: { element: { origin?: { x: string; y: string } } } | undefined,
    box: RectLike,
  ): Point {
    const pct = layer
      ? resolvePivot({ element: { origin: layer.element.origin } }, null, box)
      : resolvePivot({}, null)
    return {
      x: box.left + (pct.xPct / 100) * box.width,
      y: box.top + (pct.yPct / 100) * box.height,
    }
  }

  function trackFor(property: AnimatableProperty): Track | null {
    return selectedLayer()?.tracks.find((t) => t.property === property) ?? null
  }

  /** Pose the preview SHOWS at the playhead for a property (plan §1c). */
  function poseAt(property: AnimatableProperty, phMs: number): string | null {
    const t = trackFor(property)
    return t ? interpolatedValueAt(t, phMs) : null
  }

  // ── Cursor management ───────────────────────────────────────────────
  // The SVG is pointer-events:none, so cursors live on the delegated
  // surface (.preview__canvas): affordance hints at rest, gesture cursors
  // mid-drag, cleared whenever nothing is hovered.

  createEffect(() => {
    const canvas = canvasRef()
    if (!canvas) return
    const g = gestureKind()
    const part = hoverPart()
    if (g === 'move') canvas.style.cursor = 'move'
    else if (g === 'rotate') canvas.style.cursor = 'grabbing'
    else if (g === 'scale') canvas.style.cursor = part ? cursorForPart(part) : 'nwse-resize'
    else if (!compositeOnly()) canvas.style.cursor = part ? cursorForPart(part) : ''
    else canvas.style.cursor = ''
  })

  // touch-action flips to `none` only while the gizmo is interactable, so
  // mobile.css's pinch-zoom stays intact when the gizmo is hidden. Both
  // toggles derive from signals so the class state stays exact across
  // remounts even though `session` itself is a plain module variable.
  createEffect(() => {
    const canvas = canvasRef()
    if (!canvas) return
    canvas.classList.toggle('kf-gizmo--live', visible())
    canvas.classList.toggle('kf-gizmo--gesturing', gestureKind() !== null)
  })

  // Pointer left the stage entirely → drop a stale hover gate.
  function onCanvasPointerLeave() {
    if (!session) setHoverPart(null)
  }

  // ── Hover + grab (delegated pointer tracking) ───────────────────────

  function onCanvasPointerMove(e: PointerEvent) {
    if (session) return // the window-level move handler owns the gesture
    const space = liveSpace()
    const geo = posedGeo()
    if (!space || !geo || originPicking()) {
      setHoverPart(null)
      return
    }
    const p = layoutPointFrom(e, space)
    setHoverPart(hitTestGizmoPosed(geo, p.x, p.y))
  }

  function onCanvasPointerDown(e: PointerEvent) {
    if (session || e.button !== 0 || originPicking()) return
    const space = liveSpace()
    const geo = posedGeo()
    if (!space || !geo || compositeOnly()) return
    const p = layoutPointFrom(e, space)
    const part = hitTestGizmoPosed(geo, p.x, p.y)
    if (!part) return // fall through: stage clicks keep selecting layers
    e.preventDefault()
    startGesture(e, part, space, p)
  }

  // ── Gesture lifecycle (module-scope session) ────────────────────────

  function startGesture(e: PointerEvent, part: GizmoPart, space: GizmoSpace, startLayout: Point) {
    const layer = selectedLayer()
    if (!layer) return
    const kind: GizmoSession['kind'] =
      part === 'body' ? 'move' : part === 'rotate' ? 'rotate' : 'scale'
    const phMs = Math.round(playhead())
    // Rotation/scale pivot in POSED space (origin + animated translate):
    // the user sees the element swing around the pivot where it renders.
    const refBox = targetBox()
    if (!refBox) return
    const pivotLayout = pivotFor(layer, refBox)
    const p0 = pose()
    const pivot: Point = { x: pivotLayout.x + p0.tx, y: pivotLayout.y + p0.ty }

    setPlaying(false) // every existing canvas gesture pauses playback (§1e)

    session = {
      pointerId: e.pointerId,
      kind,
      property: GIZMO_PROPERTIES[kind],
      layerId: layer.id,
      space,
      startClient: { x: e.clientX, y: e.clientY },
      startLayout,
      box: refBox,
      pivot,
      startTranslate: parseTranslatePair(poseAt('translate', phMs) ?? '0px 0px'),
      startRotDeg: parseRotateDeg(poseAt('rotate', phMs) ?? '0deg'),
      startScale: parseScaleNum(poseAt('scale', phMs) ?? '1'),
      startAngleRad: pointerAngleRad(pivot, startLayout.x, startLayout.y),
      startDist: Math.hypot(startLayout.x - pivot.x, startLayout.y - pivot.y),
      playheadMs: phMs,
      latest: null,
      raf: 0,
      receipts: [],
      lastClient: { x: e.clientX, y: e.clientY },
    }
    setGestureKind(kind)
    setHoverPart(part) // gesture owns visibility from this instant

    window.addEventListener('pointermove', onGestureMove)
    window.addEventListener('pointerup', onGestureUp)
    window.addEventListener('pointercancel', onGestureUp)
    window.addEventListener('keydown', onGestureKeyDown)
    try {
      canvasRef()?.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events may not support capture */
    }
  }

  function computeValue(s: GizmoSession, e: PointerEvent): string {
    const cur = toLayoutPoint(s.space, e.clientX, e.clientY)
    if (s.kind === 'move') {
      const d = moveDelta(
        { x: s.startClient.x, y: s.startClient.y, space: s.space },
        e.clientX,
        e.clientY,
      )
      return formatTranslate(s.startTranslate.x + d.dx, s.startTranslate.y + d.dy)
    }
    if (s.kind === 'rotate') {
      const dRad = rotationDelta(
        s.startAngleRad,
        s.pivot,
        s.startLayout.x,
        s.startLayout.y,
        cur.x,
        cur.y,
      )
      let deg = s.startRotDeg + (dRad * 180) / Math.PI
      if (e.shiftKey) deg = snapRotationToStep(deg, 15)
      return formatRotateDeg(deg)
    }
    const factor = scaleFactor(s.pivot, s.startDist, cur.x, cur.y)
    return formatScaleNum(clampScale(s.startScale * factor))
  }

  function chipText(s: Pick<GizmoSession, 'kind'>, value: string): string {
    if (s.kind === 'move') return `translate ${value}`
    if (s.kind === 'rotate') return `rotate ${value}`
    return `scale ${Number(value).toFixed(2)}×`
  }

  function onGestureMove(e: PointerEvent) {
    const s = session
    if (!s || e.pointerId !== s.pointerId) return
    s.lastClient = { x: e.clientX, y: e.clientY }
    const value = computeValue(s, e)
    s.latest = value
    const cur = toLayoutPoint(s.space, e.clientX, e.clientY)
    setChip({ x: cur.x + 16, y: cur.y - 36, text: chipText(s, value) })
    if (!s.raf) {
      s.raf = requestAnimationFrame(() => flushWrite(s))
    }
  }

  /** One store write per frame; each frame's receipt feeds Esc-cancel. */
  function flushWrite(s: GizmoSession) {
    s.raf = 0
    if (s.latest === null) return
    const receipt = applyGizmoEdit(s.layerId, s.property, s.playheadMs, s.latest)
    if (receipt) {
      const last = s.receipts[s.receipts.length - 1]
      const dup =
        last !== undefined &&
        last.kind === receipt.kind &&
        last.trackId === receipt.trackId &&
        last.kfId === receipt.kfId
      if (!dup) s.receipts.push(receipt)
    }
  }

  function onGestureUp(e: PointerEvent) {
    const s = session
    if (!s || e.pointerId !== s.pointerId) return
    endGesture(true)
  }

  /** Escape cancels: restore pre-drag values structurally (plan §3). */
  function onGestureKeyDown(e: KeyboardEvent) {
    if (!session || e.key !== 'Escape') return
    e.preventDefault()
    endGesture(false)
  }

  function detachGestureListeners(pointerId: number) {
    window.removeEventListener('pointermove', onGestureMove)
    window.removeEventListener('pointerup', onGestureUp)
    window.removeEventListener('pointercancel', onGestureUp)
    window.removeEventListener('keydown', onGestureKeyDown)
    try {
      canvasRef()?.releasePointerCapture(pointerId)
    } catch {
      /* already released or element gone */
    }
  }

  function endGesture(commit: boolean) {
    const s = session
    if (!s) return
    session = null
    if (s.raf) cancelAnimationFrame(s.raf)
    detachGestureListeners(s.pointerId)

    // Release beats the last frame: guarantee the exact final write lands
    // (same tail-loss guard as Inspector's scrub session).
    if (commit && s.latest !== null) flushWrite(s)
    else reverseReceipts(s.layerId, s.receipts)

    setChip(null)
    setGestureKind(null)
    // Re-hit-test from the release point: the gizmo stays visible iff the
    // pointer still rests over its geometry (hover takes back over).
    const space = liveSpace()
    const geo = posedGeo()
    if (space && geo) {
      const p = toLayoutPoint(space, s.lastClient.x, s.lastClient.y)
      setHoverPart(hitTestGizmoPosed(geo, p.x, p.y))
    } else {
      setHoverPart(null)
    }
  }

  function reverseReceipts(layerId: string, receipts: GizmoEditReceipt[]) {
    for (let i = receipts.length - 1; i >= 0; i--) {
      const r = receipts[i]
      if (r.kind === 'update-kf' && r.kfId !== undefined) {
        updateKeyframe(layerId, r.trackId, r.kfId, { value: r.originalValue })
      } else if (r.kind === 'create-kf' && r.kfId !== undefined) {
        removeKeyframe(layerId, r.trackId, r.kfId)
      } else if (r.kind === 'create-track-and-kf') {
        removeTrack(layerId, r.trackId)
      }
    }
  }

  // ── Mount: find the canvas + install delegated listeners ────────────

  onMount(() => {
    const canvas = containerEl?.closest<HTMLDivElement>('.preview__canvas') ?? null
    setCanvasRef(canvas)
    if (!canvas) return
    canvas.addEventListener('pointermove', onCanvasPointerMove)
    canvas.addEventListener('pointerdown', onCanvasPointerDown)
    canvas.addEventListener('pointerleave', onCanvasPointerLeave)
    onCleanup(() => {
      canvas.removeEventListener('pointermove', onCanvasPointerMove)
      canvas.removeEventListener('pointerdown', onCanvasPointerDown)
      canvas.removeEventListener('pointerleave', onCanvasPointerLeave)
    })
  })

  onCleanup(() => {
    if (session) endGesture(false) // unmount mid-gesture cancels safely
    setHoverPart(null)
  })

  // ── Render ──────────────────────────────────────────────────────────
  // Everything draws in canvas-layout px (no viewBox on purpose: 1 user
  // unit = 1 css px pre-scale, same convention as .kf-origin-debug).
  // Geometry is POSED: the outline/handles compose the layer's current
  // playhead pose, so they sit on the element as it renders (owner
  // feedback) — not on its un-transformed reference box.

  const GLYPH = CORNER_HIT_PX / 2 // 12px glyph inside each 24px target

  return (
    <div
      ref={(el) => {
        containerEl = el
      }}
      class="kf-gizmo"
      classList={{ 'kf-gizmo--readonly': compositeOnly() }}
    >
      <Show when={visible()}>
        <Show when={posedGeo()}>
          {(geo) => (
            <>
              <svg class="kf-gizmo__svg" aria-hidden="true">
                {/* Posed outline — accent stroke, drawn through the four
                    transformed corners so it hugs the animated element. */}
                <polygon
                  class="kf-gizmo__box"
                  points={geo()
                    .polygon.map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  vector-effect="non-scaling-stroke"
                />
                <line
                  class="kf-gizmo__stem"
                  x1={geo().stemBase.x}
                  y1={geo().stemBase.y}
                  x2={geo().rotateCenter.x}
                  y2={geo().rotateCenter.y}
                  vector-effect="non-scaling-stroke"
                />
                <circle
                  class="kf-gizmo__rotate"
                  cx={geo().rotateCenter.x}
                  cy={geo().rotateCenter.y}
                  r={ROTATE_HANDLE_R}
                />
                <For each={geo().corners}>
                  {(c) => (
                    <rect
                      class="kf-gizmo__corner"
                      data-part={c.part}
                      x={c.x - GLYPH / 2}
                      y={c.y - GLYPH / 2}
                      width={GLYPH}
                      height={GLYPH}
                    />
                  )}
                </For>
              </svg>
              <Show when={chip()}>
                {(c) => (
                  <div class="kf-gizmo__chip" style={{ left: `${c().x}px`, top: `${c().y}px` }}>
                    {c().text}
                  </div>
                )}
              </Show>
              <Show when={compositeOnly()}>
                <div
                  class="kf-gizmo__badge"
                  style={{
                    left: `${Math.min(...geo().polygon.map((p) => p.x))}px`,
                    top: `${Math.max(...geo().polygon.map((p) => p.y)) + 10}px`,
                  }}
                >
                  composite — edit in inspector
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  )
}
