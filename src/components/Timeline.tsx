import { createEffect, createMemo, onCleanup, onMount } from 'solid-js'
import {
  doc,
  playhead,
  setPlayhead,
  setPlaying,
  setDuration,
  selectedLayerId,
  selectedKeyframeId,
  setSelectedKeyframeId,
  setSelectedLayerId,
  updateKeyframe,
  snapIncrement,
  theme,
} from '@/store'
import { snapTime } from '@/utils/snap'
import { chooseLabelStep, formatTick, minorStepFor } from '@/utils/rulerScale'
import {
  HEADER_HEIGHT,
  buildRowModel,
  rowContentHeight,
  rowIndexAt,
  type LayerRow,
  type TrackRow,
} from '@/utils/rowModel'
import Playback from '@/components/Playback'
import RowHeaders from '@/components/RowHeaders'
import { setKeyframeSelectionSource } from '@/utils/selectionSource'
import { createMediaQuery } from '@/utils/mediaQuery'

/** Coarse pointers get 44px row targets (plan §3.1). */
const COARSE_ROW_HEIGHT = 44
const KF_RADIUS = 6
const TOUCH_SLOP = 10
const HANDLE_HIT = 12
/** Half-width of the playhead's grabbable column, in CSS px (audit F24). */
const PLAYHEAD_HIT = 6
/** Breathing room required after each ruler label (plan §4). */
const LABEL_GAP_PX = 12
/** Ticks closer than this many CSS px read as noise (plan §4). */
const MIN_TICK_SPACING_PX = 6
/** Opacity for lane gridlines over track backgrounds (plan §3). */
const GRIDLINE_ALPHA = 0.35
/** Density-strip band cap: >6 tracks merge their surplus into the 6th band. */
const MAX_STRIP_BANDS = 6

export default function Timeline() {
  let canvas: HTMLCanvasElement | undefined
  // Stage wrapper around the canvas — the row-header column's positioning
  // context and the ResizeObserver target.
  let raf: number
  let draggingKf: { layerId: string; trackId: string; kfId: string } | null = null
  let scrubbing = false
  let resizingDuration = false
  /** pointerId of the gesture currently owning the canvas, if any */
  let activePointerId: number | null = null
  let downX = 0
  let downY = 0
  let downPointerType = 'mouse'
  let movedPastSlop = false
  /** Keyframe under the cursor (audit F10b/F25) — hover feedback only. */
  let hoverKf: { layerId: string; trackId: string; kfId: string } | null = null
  /** Cursor x over the ruler/scrub (CSS px) — drives the ghost time chip (F10c/F23). */
  let ghostX: number | null = null
  /**
   * Where the gesture would LAND under snapping, while dragging. The real
   * playhead/keyframe follows the cursor continuously (owner feedback: hard
   * mid-drag snapping feels laggy); this ghost shows the destination and the
   * value snaps there once, on release.
   */
  let dragSnapTime: number | null = null
  /** Layer whose disclosure zone is hovered — accent-color feedback only. */

  /**
   * Single source of truth for vertical geometry (see utils/rowModel.ts).
   * Never recompute `y = HEADER_HEIGHT + row * TRACK_HEIGHT` locally — ask
   * this memo. Consumers: draw(), hit-testing, cursor logic, resize() AND
   * the DOM row-header column, which is why the two can never drift.
   * buildRowModel transitively tracks track counts AND collapse flags, so
   * reactive effects can depend on `rows().length` alone for sizing.
   * Coarse pointers bump every row to a 44px touch target (plan §3.1).
   */
  const coarsePointer = createMediaQuery('(pointer: coarse)')
  const rows = createMemo(() =>
    buildRowModel(
      doc.layers,
      undefined,
      coarsePointer()
        ? { trackHeight: COARSE_ROW_HEIGHT, layerRowHeight: COARSE_ROW_HEIGHT }
        : undefined,
    ),
  )

  function timeToX(time: number, width: number) {
    return (time / doc.duration) * width
  }

  function xToTime(x: number, width: number) {
    return Math.max(0, Math.min(doc.duration, (x / width) * doc.duration))
  }

  function applyDurationFromX(x: number) {
    const msPerPx = doc.duration / canvas!.offsetWidth
    const newDur = Math.max(100, Math.round((x * msPerPx) / 50) * 50)
    setPlayhead((prev) => Math.min(prev, newDur))
    setDuration(newDur)
  }

  /** Redraw outside store reactivity (hover/ghost state lives outside the store). */
  function scheduleDraw() {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(draw)
  }

  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { width, height } = canvas
    const dpr = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, width, height)

    const cssVars = getComputedStyle(document.documentElement)
    const colorBg = cssVars.getPropertyValue('--color-surface').trim()
    const colorBorder = cssVars.getPropertyValue('--color-border').trim()
    const colorText = cssVars.getPropertyValue('--color-text-muted').trim()
    const colorAccent = cssVars.getPropertyValue('--color-accent').trim()
    // Canvas-painted surfaces (theme tokens — never literals here):
    // group rows, the selected-lane tint, and the selected-diamond fill.
    const colorRowGroup = cssVars.getPropertyValue('--color-row-group').trim()
    const colorRowSelected = cssVars.getPropertyValue('--color-row-selected').trim()
    const colorKfSelected = cssVars.getPropertyValue('--color-kf-selected').trim()
    const trackColors = [
      cssVars.getPropertyValue('--color-track-1').trim(),
      cssVars.getPropertyValue('--color-track-2').trim(),
      cssVars.getPropertyValue('--color-track-3').trim(),
      cssVars.getPropertyValue('--color-track-4').trim(),
    ]

    ctx.fillStyle = colorBg
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = colorBorder
    ctx.fillRect(0, 0, width, HEADER_HEIGHT * dpr)

    ctx.font = `${11 * dpr}px monospace`
    ctx.textBaseline = 'middle'
    // Adaptive label density: the finest nice (1-2-5) step whose labels
    // can't collide in the current lane width, floored at duration/10 and
    // capped at 1 ms. Measured AFTER the ruler font is set so widths match
    // what's actually drawn (plan §4).
    const cssWidth = width / dpr
    const laneRight = cssWidth - HANDLE_HIT
    const laneWidthCss = cssWidth
    const pxPerMs = doc.duration / laneWidthCss
    const measureLabel = (label: string) => ctx.measureText(label).width / dpr
    const labelStep = chooseLabelStep(
      doc.duration,
      laneWidthCss,
      LABEL_GAP_PX,
      MIN_TICK_SPACING_PX,
      measureLabel,
    )
    const minorStep = minorStepFor(labelStep, pxPerMs)
    // Major ticks at multiples of the step from 0 to floor(duration/step)*step.
    // The last major may land before `duration` for non-divisible steps — the
    // bold duration readout at the right edge still marks the end (plan §4).
    const lastMajorIndex = Math.floor(doc.duration / labelStep)
    const majorTimes: number[] = []
    for (let i = 0; i <= lastMajorIndex; i++) majorTimes.push(i * labelStep)
    for (const t of majorTimes) {
      const x = timeToX(t, cssWidth)
      ctx.fillStyle = colorBorder
      ctx.fillRect(x * dpr, 0, 1, HEADER_HEIGHT * dpr)
      const label = formatTick(t, labelStep)
      const labelW = ctx.measureText(label).width / dpr
      let lx = x + 4
      if (lx + labelW > laneRight - 2) lx = laneRight - 2 - labelW
      ctx.fillStyle = colorText
      ctx.fillText(label, lx * dpr, (HEADER_HEIGHT / 2) * dpr)
    }
    // Minor ticks between majors — a fifth of the label step, falling back
    // to a half when that would sit closer than 4px apart (plan §4).
    const minorRatio = Math.round(labelStep / minorStep) // exactly 5 or 2
    const minorCount = Math.floor(doc.duration / minorStep)
    ctx.fillStyle = colorBorder
    for (let j = 1; j <= minorCount; j++) {
      if (j % minorRatio === 0) continue // lands on a labeled major
      const t = j * minorStep
      if (t >= doc.duration) break
      const x = timeToX(t, cssWidth)
      ctx.fillRect(x * dpr, 0, 1, 4 * dpr)
    }

    ctx.font = `bold ${10 * dpr}px monospace`
    ctx.textAlign = 'right'
    ctx.fillStyle = colorAccent
    ctx.fillText(`${doc.duration}ms`, width - (HANDLE_HIT + 4) * dpr, (HEADER_HEIGHT / 2) * dpr)
    ctx.textAlign = 'left'

    const handleX = width - (HANDLE_HIT * dpr) / 2
    ctx.fillStyle = colorAccent
    ctx.fillRect(handleX - dpr, 0, 2 * dpr, HEADER_HEIGHT * dpr)
    const cx = handleX
    const cy = (HEADER_HEIGHT / 2) * dpr
    const aw = 3 * dpr
    ctx.beginPath()
    ctx.moveTo(cx - aw, cy - aw)
    ctx.lineTo(cx - aw * 2, cy)
    ctx.lineTo(cx - aw, cy + aw)
    ctx.moveTo(cx + aw, cy - aw)
    ctx.lineTo(cx + aw * 2, cy)
    ctx.lineTo(cx + aw, cy + aw)
    ctx.strokeStyle = colorAccent
    ctx.lineWidth = 1.5 * dpr
    ctx.stroke()

    // Empty-timeline hint (audit F19): with zero layers the lanes area is
    // a blank rectangle — echo the EmptyState moment right where tracks
    // will appear. Styled like the app's muted text.
    if (doc.layers.length === 0) {
      const hint = 'No tracks yet — add a layer to start'
      ctx.font = `${11 * dpr}px monospace`
      ctx.fillStyle = colorText
      ctx.textAlign = 'center'
      const hintY = (HEADER_HEIGHT + (height / dpr - HEADER_HEIGHT) / 2) * dpr
      ctx.fillText(hint, width / 2, hintY)
      ctx.textAlign = 'left'
    }

    // Id lookups for the model's rows (rows carry ids, draw needs objects).
    const layerById = new Map(doc.layers.map((l) => [l.id, l] as const))
    const trackIndexOf = new Map<string, number>()
    for (const l of doc.layers) l.tracks.forEach((t, ti) => trackIndexOf.set(t.id, ti))

    /** Track lane — pixel-identical to the pre-model version minus labels
     *  (the DOM header column owns all label text since Phase A). */
    const drawTrackRow = (row: TrackRow) => {
      const layer = layerById.get(row.layerId)
      const ti = trackIndexOf.get(row.trackId)
      if (!layer || ti === undefined) return
      const track = layer.tracks[ti]
      if (!track) return
      const y = row.y * dpr
      // Hidden layers dim instead of vanishing (row-model identity depends
      // on them staying put) — matching AE and the header's dimmed state.
      ctx.save()
      if (!layer.visible) ctx.globalAlpha = 0.35
      ctx.fillStyle = selectedLayerId() === row.layerId ? colorRowSelected : colorBg
      ctx.fillRect(0, y, width, row.height * dpr)
      // Label gridlines through the lanes (plan §3): after the row
      // background but before diamonds, so full-height lines stay visible
      // without washing out keyframes.
      ctx.save()
      ctx.globalAlpha = GRIDLINE_ALPHA * ctx.globalAlpha
      ctx.fillStyle = colorBorder
      for (const t of majorTimes) {
        ctx.fillRect(timeToX(t, width / dpr) * dpr, y, 1, row.height * dpr)
      }
      ctx.restore()
      ctx.fillStyle = colorBorder
      ctx.fillRect(0, y + row.height * dpr - 1, width, 1)
      ctx.fillRect(0, y + (row.height / 2) * dpr, width, 1)
      // Track property label painted just past the label zone boundary —
      // small, muted, non-interactive (plan §3.2: track bands keep their
      // property label as plain text).
      ctx.fillStyle = colorText
      ctx.font = `${10 * dpr}px monospace`
      ctx.textBaseline = 'middle'
      ctx.fillText(track.property, 8 * dpr, y + (row.height / 2) * dpr)
      track.keyframes.forEach((kf) => {
        const x = timeToX(kf.time, width / dpr) * dpr
        const cy2 = y + (row.height / 2) * dpr
        const isSelected = selectedKeyframeId() === kf.id
        const isHovered =
          hoverKf !== null &&
          hoverKf.layerId === row.layerId &&
          hoverKf.trackId === row.trackId &&
          hoverKf.kfId === kf.id
        ctx.save()
        ctx.translate(x, cy2)
        ctx.rotate(Math.PI / 4)
        // Hover scales 1.3× (F10b/F25); selected reads as white + accent ring;
        // every diamond carries a 1px bg outline so it stays crisp on all
        // four track colors (F25).
        const r = KF_RADIUS * dpr * (isHovered ? 1.3 : 1)
        const color = trackColors[ti % trackColors.length]
        ctx.fillStyle = isSelected ? colorKfSelected : color
        ctx.fillRect(-r / 2, -r / 2, r, r)
        ctx.lineWidth = 1 * dpr
        ctx.strokeStyle = colorBg
        ctx.strokeRect(-r / 2, -r / 2, r, r)
        if (isSelected) {
          ctx.lineWidth = 2 * dpr
          ctx.strokeStyle = colorAccent
          ctx.strokeRect(-r / 2 - 1.5 * dpr, -r / 2 - 1.5 * dpr, r + 3 * dpr, r + 3 * dpr)
        }
        ctx.restore()
      })
      ctx.restore() // hidden-layer dim wrapper
    }

    /**
     * Layer header band — every layer gets one (expanded or collapsed).
     * Phase A: the chevron/name glyphs moved to the DOM row-header column;
     * the canvas keeps only backgrounds, hairlines and (collapsed-only) the
     * mini-density strip, so [0, LABEL_WIDTH−14) paints no text/glyphs.
     */
    const drawLayerRow = (row: LayerRow) => {
      const layer = layerById.get(row.layerId)
      const y = row.y * dpr
      const hD = row.height * dpr
      const isSelected = selectedLayerId() === row.layerId
      ctx.save()
      if (layer && !layer.visible) ctx.globalAlpha = 0.35
      // Group-header background: slightly darker neutral so summary rows read
      // as groups; the selected-layer tint wins when it applies.
      ctx.fillStyle = isSelected ? colorRowSelected : colorRowGroup
      ctx.fillRect(0, y, width, hD)
      // Full-width top + bottom hairlines separate groups crisply.
      ctx.fillStyle = colorBorder
      ctx.fillRect(0, y, width, 1)
      ctx.fillRect(0, y + hD - 1, width, 1)

      // ── Mini-density strip in the lanes area: one thin band per track,
      // stacked and centered in the row — a silent preview of expansion.
      // Collapsed bands only: expanded layers show their real lanes right
      // below. Capped at MAX_STRIP_BANDS bands; surplus merges into the last.
      const tracksOfLayer = layer?.tracks ?? []
      const bandCount =
        layer?.collapsed === true ? Math.min(tracksOfLayer.length, MAX_STRIP_BANDS) : 0
      if (bandCount > 0) {
        const bandH = Math.min(4, Math.floor((row.height - 8) / bandCount))
        if (bandH > 0) {
          const stripH = bandCount * bandH
          let bandYCss = row.y + (row.height - stripH) / 2
          const laneLeftDev = 0
          const laneWDev = Math.max(0, width)
          for (let b = 0; b < bandCount; b++) {
            const from = b
            const to = b === MAX_STRIP_BANDS - 1 ? tracksOfLayer.length : b + 1
            const slice = tracksOfLayer.slice(from, to)
            const hasKfs = slice.some((t) => t.keyframes.length > 0)
            if (!hasKfs) {
              // Faint baseline dash keeps "track exists but no keyframes" legible.
              ctx.save()
              ctx.globalAlpha = 0.15
              ctx.fillStyle = colorBorder
              ctx.fillRect(laneLeftDev, (bandYCss + bandH / 2) * dpr, laneWDev, Math.max(1, dpr))
              ctx.restore()
            } else {
              ctx.save()
              ctx.globalAlpha = 0.35
              for (let ti2 = from; ti2 < to; ti2++) {
                // Global track index keys the color, so bands match the diamonds
                // expanding reveals.
                ctx.fillStyle = trackColors[ti2 % trackColors.length]
                for (const kf of tracksOfLayer[ti2].keyframes) {
                  const kx = timeToX(kf.time, width / dpr) * dpr
                  ctx.fillRect(kx, bandYCss * dpr, 3 * dpr, bandH * dpr)
                }
              }
              ctx.restore()
            }
            bandYCss += bandH
          }
        } // closes if (bandH > 0)
      } // closes if (bandCount > 0)
    }

    for (const row of rows()) {
      if (row.type === 'track') drawTrackRow(row)
      else drawLayerRow(row)
    }

    // Playhead (audit F24): triangle head in the ruler, glow while
    // scrubbing, time bubble during drags. The line itself stays a 2px
    // accent hairline.
    const ph = timeToX(playhead(), width / dpr) * dpr
    if (scrubbing) {
      ctx.save()
      ctx.shadowColor = colorAccent
      ctx.shadowBlur = 8 * dpr
      ctx.fillStyle = colorAccent
      ctx.fillRect(ph, 0, 2 * dpr, height)
      ctx.restore()
    } else {
      ctx.fillStyle = colorAccent
      ctx.fillRect(ph, 0, 2 * dpr, height)
    }
    // Triangle head pointing into the timeline (owner preference; reverts
    // #62's dot/cap while keeping glow + time bubble + grab column).
    // Apex at y=10px like the pre-#62 version, so it stays inside
    // HEADER_HEIGHT even if that constant shrinks. 1px bg outline keeps it
    // crisp over the ruler border, same convention as keyframe diamonds.
    ctx.beginPath()
    ctx.moveTo(ph - 6 * dpr, 0)
    ctx.lineTo(ph + 6 * dpr, 0)
    ctx.lineTo(ph, 10 * dpr)
    ctx.fillStyle = colorAccent
    ctx.fill()
    ctx.lineWidth = 1 * dpr
    ctx.strokeStyle = colorBg
    ctx.stroke()
    // Time bubble while scrubbing — eyes stay on the playhead, not the counter.
    if (scrubbing) {
      drawTimeChip(
        ctx,
        ph / dpr,
        HEADER_HEIGHT + 6,
        `${(playhead() / 1000).toFixed(2)}s`,
        width / dpr,
        dpr,
        colorBg,
        colorBorder,
        colorText,
      )
    }
    // Ghost time chip following the cursor over the ruler (F10c/F23).
    if (!scrubbing && ghostX !== null) {
      const t = xToTime(ghostX, width / dpr)
      drawTimeChip(
        ctx,
        ghostX,
        HEADER_HEIGHT + 6,
        `${(t / 1000).toFixed(2)}s`,
        width / dpr,
        dpr,
        colorBg,
        colorBorder,
        colorText,
      )
    }
    // Snap ghost while dragging (owner model): the real playhead follows the
    // cursor continuously; a dashed accent line + chip show WHERE it will land
    // under snapping. Hidden when the snap point sits on the playhead itself.
    if (scrubbing && dragSnapTime !== null) {
      const sx = timeToX(dragSnapTime, width / dpr) * dpr
      if (Math.abs(sx - ph) > 1 * dpr) {
        ctx.save()
        ctx.globalAlpha = 0.55
        ctx.strokeStyle = colorAccent
        ctx.lineWidth = 2 * dpr
        ctx.setLineDash([4 * dpr, 4 * dpr])
        ctx.beginPath()
        ctx.moveTo(sx, 0)
        ctx.lineTo(sx, height)
        ctx.stroke()
        ctx.restore()
        drawTimeChip(
          ctx,
          sx / dpr,
          HEADER_HEIGHT + 6,
          `${(dragSnapTime / 1000).toFixed(2)}s`,
          width / dpr,
          dpr,
          colorBg,
          colorBorder,
          colorAccent,
        )
      }
    }
    // Keyframe-drag snap ghost: outlined diamond at the landing point on the
    // dragged track's row.
    if (draggingKf && dragSnapTime !== null && !scrubbing) {
      const dragged = draggingKf
      const row = rows().find(
        (r) => r.type === 'track' && r.layerId === dragged.layerId && r.trackId === dragged.trackId,
      )
      if (row) {
        const gx = timeToX(dragSnapTime, width / dpr) * dpr
        const gy = (row.y + row.height / 2) * dpr
        ctx.save()
        ctx.translate(gx, gy)
        ctx.rotate(Math.PI / 4)
        ctx.strokeStyle = colorAccent
        ctx.lineWidth = 1.5 * dpr
        const gr = KF_RADIUS * dpr * 1.3
        ctx.strokeRect(-gr / 2, -gr / 2, gr, gr)
        ctx.restore()
      }
    }
  }

  /** Small rounded time label drawn just under the ruler near an x position. */
  function drawTimeChip(
    ctx: CanvasRenderingContext2D,
    xCss: number,
    yCss: number,
    text: string,
    cssWidth: number,
    dpr: number,
    bg: string,
    border: string,
    fg: string,
  ) {
    ctx.font = `${10 * dpr}px monospace`
    ctx.textBaseline = 'middle'
    const padX = 5 * dpr
    const w = ctx.measureText(text).width + padX * 2
    const h = 16 * dpr
    let x = xCss * dpr - w / 2
    const minX = 0
    const maxX = cssWidth * dpr - HANDLE_HIT * dpr - w
    x = Math.max(minX, Math.min(x, maxX))
    const y = yCss * dpr
    ctx.fillStyle = bg
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 3 * dpr)
    ctx.fill()
    ctx.strokeStyle = border
    ctx.lineWidth = 1 * dpr
    ctx.stroke()
    ctx.fillStyle = fg
    ctx.fillText(text, x + padX, y + h / 2 + 0.5 * dpr)
  }

  function resize() {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    // The canvas's dedicated parent is .timeline__scroll — the panel box minus
    // the transport strip above — so "visible rows" math stays correct.
    const rect = canvas.parentElement!.getBoundingClientRect()
    // Grow beyond the visible panel when there are more rows than fit, so the
    // container can scroll vertically instead of clipping tracks. Height comes
    // from the row model — never recomputed locally.
    const contentHeight = rowContentHeight(rows())
    const height = Math.max(rect.height, contentHeight)
    canvas.width = rect.width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${height}px`
    draw()
  }

  function cssX(e: PointerEvent | MouseEvent) {
    return e.clientX - canvas!.getBoundingClientRect().left
  }

  function cssY(e: PointerEvent | MouseEvent) {
    return e.clientY - canvas!.getBoundingClientRect().top
  }

  function isOverHandle(x: number) {
    return x >= canvas!.offsetWidth - HANDLE_HIT
  }

  /** True when x sits within the playhead's grabbable column (F24). */
  function nearPlayhead(x: number) {
    const ph = timeToX(playhead(), canvas!.offsetWidth)
    return Math.abs(x - ph) <= PLAYHEAD_HIT
  }

  /**
   * Cursor per zone while no gesture owns the canvas (audit F10a):
   * grab over diamonds, ew-resize over ruler/handle/playhead column.
   */
  function updateCursor(x: number, y: number) {
    if (y < HEADER_HEIGHT) {
      canvas!.style.cursor = 'ew-resize'
      return
    }
    if (nearPlayhead(x)) {
      canvas!.style.cursor = 'ew-resize'
      return
    }
    canvas!.style.cursor = hitTestKeyframe(x, y) ? 'grab' : ''
  }

  function hitTestKeyframe(x: number, y: number) {
    const i = rowIndexAt(rows(), y)
    if (i === null) return null
    const row = rows()[i]
    // Layer rows never contain keyframes — hover/cursor fall through.
    if (row.type !== 'track') return null
    const layer = doc.layers.find((l) => l.id === row.layerId)
    const track = layer?.tracks.find((t) => t.id === row.trackId)
    if (!layer || !track) return null
    for (const kf of track.keyframes) {
      const kx = timeToX(kf.time, canvas!.offsetWidth)
      if (Math.abs(x - kx) < KF_RADIUS + 8) {
        return { layerId: layer.id, trackId: track.id, kfId: kf.id }
      }
    }
    return null
  }

  function promptDuration() {
    const raw = prompt('Set duration (ms):', String(doc.duration))
    if (raw === null) return
    const ms = parseInt(raw, 10)
    if (!isNaN(ms) && ms >= 100) {
      setPlaying(false)
      setPlayhead((prev) => Math.min(prev, ms))
      setDuration(ms)
    }
  }

  function beginDrag(e: PointerEvent) {
    activePointerId = e.pointerId
    downX = cssX(e)
    downY = cssY(e)
    downPointerType = e.pointerType
    movedPastSlop = false
  }

  function endDrag() {
    // Release lands the gesture on its snap point (one deliberate jump —
    // owner model: fluid follow while dragging, snap where it lands).
    if (dragSnapTime !== null) {
      if (draggingKf) {
        updateKeyframe(draggingKf.layerId, draggingKf.trackId, draggingKf.kfId, {
          time: Math.round(dragSnapTime),
        })
      } else if (scrubbing) {
        setPlayhead(dragSnapTime)
      }
    }
    resizingDuration = false
    draggingKf = null
    scrubbing = false
    activePointerId = null
    // Ghost chip tracks the cursor; drop it with the gesture so it never
    // lingers where the pointer no longer is.
    ghostX = null
    dragSnapTime = null
  }

  function onPointerDown(e: PointerEvent) {
    if (activePointerId !== null) return // a gesture already owns the canvas
    beginDrag(e)
    // Capture the pointer so moves/ups keep streaming to the canvas even when
    // the cursor (or finger) leaves the timeline area mid-gesture.
    try {
      canvas!.setPointerCapture(e.pointerId)
    } catch {
      // Pointer no longer active (e.g. synthetic event) — in-canvas drags still work.
    }
    const x = downX
    const y = downY
    if (y < HEADER_HEIGHT) {
      if (isOverHandle(x)) {
        resizingDuration = true
        setPlaying(false)
        return
      }
      scrubbing = true
      ghostX = x
      setPlaying(false)
      // Continuous follow during the drag; snapping lands on release.
      const raw = xToTime(x, canvas!.offsetWidth)
      setPlayhead(raw)
      dragSnapTime = snapTime(raw, snapIncrement(), doc.duration)
      return
    }
    // Disclosure click zones take precedence over every other gesture below
    // the header — a chevron press must never start a scrub or playhead jump.
    const hitRowIdx = rowIndexAt(rows(), y)
    const hitRow = hitRowIdx !== null ? rows()[hitRowIdx] : null
    if (hitRow?.type === 'layer') {
      // Summary-row body: select-only — the label strip is a control surface,
      // not a scrub target (prevents surprise playhead jumps).
      setSelectedLayerId(hitRow.layerId)
      endDrag()
      return
    }
    const hit = hitTestKeyframe(x, y)
    if (hit) {
      draggingKf = hit
      // Selecting a keyframe also selects its layer so the Inspector,
      // which gates on the layer selection, shows the owning tracks.
      // F11: record the origin first — the inspector scrolls its owning row
      // into view only for canvas-initiated selections (its own clicks must
      // not scroll-jack).
      setKeyframeSelectionSource('canvas')
      setSelectedKeyframeId(hit.kfId)
      setSelectedLayerId(hit.layerId)
      canvas!.style.cursor = 'grabbing'
    } else if (nearPlayhead(x)) {
      // Grab the playhead where it is instead of jumping it to the click
      // point (audit F24) — the most-grabbed object gets its own column.
      scrubbing = true
      setPlaying(false)
    } else {
      scrubbing = true
      ghostX = x
      setPlaying(false)
      const raw = xToTime(x, canvas!.offsetWidth)
      setPlayhead(raw)
      dragSnapTime = snapTime(raw, snapIncrement(), doc.duration)
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (activePointerId !== null && e.pointerId !== activePointerId) return
    const x = cssX(e)
    const y = cssY(e)
    if (!movedPastSlop && (Math.abs(x - downX) > TOUCH_SLOP || Math.abs(y - downY) > TOUCH_SLOP))
      movedPastSlop = true
    if (resizingDuration) {
      applyDurationFromX(x)
      return
    }
    if (scrubbing) {
      ghostX = x
      const raw = xToTime(x, canvas!.offsetWidth)
      setPlayhead(raw) // every frame, unsnapped — preview stays fluid
      dragSnapTime = snapTime(raw, snapIncrement(), doc.duration)
    }
    // Touch keeps its small-movement slop so sloppy taps don't nudge keyframes.
    if (draggingKf && (downPointerType !== 'touch' || movedPastSlop)) {
      const raw = Math.round(xToTime(x, canvas!.offsetWidth))
      updateKeyframe(draggingKf.layerId, draggingKf.trackId, draggingKf.kfId, { time: raw })
      dragSnapTime = snapTime(raw, snapIncrement(), doc.duration)
    }
    if (activePointerId === null) {
      // Hover-only state: zone cursor, hovered diamond/chevron, ghost chip.
      const overRulerOrScrub = y < HEADER_HEIGHT || nearPlayhead(x)
      hoverKf = overRulerOrScrub ? null : hitTestKeyframe(x, y)
      ghostX = y < HEADER_HEIGHT ? x : null
      updateCursor(x, y)
    }
    scheduleDraw()
  }

  function onPointerLeave() {
    hoverKf = null
    ghostX = null
    scheduleDraw()
  }

  function onPointerUp(e: PointerEvent) {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    const wasTap = !movedPastSlop
    const startX = downX
    const startY = downY
    const pointerType = downPointerType
    endDrag()
    // Preserve the old touch affordance: tapping the duration handle prompts.
    if (pointerType === 'touch' && wasTap && startY < HEADER_HEIGHT && isOverHandle(startX)) {
      promptDuration()
    }
    scheduleDraw()
  }

  /** Safety net: if capture is lost mid-gesture (e.g. pointercancel), end cleanly. */
  function onLostPointerCapture(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    endDrag()
  }

  function onWheel(e: WheelEvent) {
    // Only hijack horizontal trackpad swipes; vertical deltas scroll the page.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    e.preventDefault()
    setPlaying(false)
    const msPerPx = doc.duration / canvas!.offsetWidth
    setPlayhead((prev) => {
      const next = Math.max(0, Math.min(doc.duration, prev + e.deltaX * msPerPx))
      return snapTime(next, snapIncrement(), doc.duration)
    })
  }

  function onDblClick(e: MouseEvent) {
    const x = cssX(e)
    const y = cssY(e)
    if (y < HEADER_HEIGHT && isOverHandle(x)) {
      promptDuration()
    }
  }

  // Pointer events cover mouse, touch and pen alike (the canvas sets
  // `touch-action: none` in CSS), so the old separate touch handlers are gone.
  function setCanvasRef(el: HTMLCanvasElement) {
    canvas = el
  }

  onMount(() => {
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas!.parentElement!)
    onCleanup(() => ro.disconnect())
  })

  createEffect(() => {
    void doc.layers.map((l) => l.tracks.map((t) => t.keyframes.map((k) => k.time)))
    void doc.duration
    void playhead()
    void selectedKeyframeId()
    void selectedLayerId()
    void theme() // repaint on theme flip — canvas colors come from CSS vars
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(draw)
  })

  // Track-count changes alter the content height — re-measure the canvas.
  createEffect(() => {
    void doc.layers.map((l) => l.tracks.length)
    resize()
  })

  onCleanup(() => cancelAnimationFrame(raf))

  return (
    <div class="timeline">
      {/* Transport strip above the ruler (plan: playback-in-timeline) — the
          controls govern this ruler/playhead/snap, so they live next to it.
          resize() still reads canvas.parentElement, which is .timeline__scroll
          below; the ResizeObserver registered on that wrapper retargets
          automatically since it observes whatever wraps the canvas at mount. */}
      <Playback variant="compact" />
      <div class="timeline__scroll">
        <div class="timeline__body">
          <div class="timeline__headers">
            <RowHeaders rows={rows()} />
          </div>
          <canvas
            ref={setCanvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onLostPointerCapture={onLostPointerCapture}
            onWheel={onWheel}
            onDblClick={onDblClick}
          />
        </div>
      </div>
    </div>
  )
}
