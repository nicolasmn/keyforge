import { createEffect, onCleanup, onMount } from 'solid-js'
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
} from '@/store'

const TRACK_HEIGHT = 36
const HEADER_HEIGHT = 28
const LABEL_WIDTH = 120
const KF_RADIUS = 6
const TOUCH_SLOP = 10
const HANDLE_HIT = 12
/** Extra px added below the last track row when sizing the canvas. */
const CONTENT_PAD_BOTTOM = 2
/** Half-width of the playhead's grabbable column, in CSS px (audit F24). */
const PLAYHEAD_HIT = 6
/** Minor tick count across the ruler (audit F23). */
const MINOR_TICKS = 50

export default function Timeline() {
  let canvas: HTMLCanvasElement | undefined
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

  function timeToX(time: number, width: number) {
    return LABEL_WIDTH + (time / doc.duration) * (width - LABEL_WIDTH)
  }

  function xToTime(x: number, width: number) {
    return Math.max(
      0,
      Math.min(doc.duration, ((x - LABEL_WIDTH) / (width - LABEL_WIDTH)) * doc.duration),
    )
  }

  function applyDurationFromX(x: number) {
    const msPerPx = doc.duration / (canvas!.offsetWidth - LABEL_WIDTH)
    const newDur = Math.max(100, Math.round(((x - LABEL_WIDTH) * msPerPx) / 50) * 50)
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
    const colorPrimary = cssVars.getPropertyValue('--color-primary').trim()
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
    // Major ticks with labels — labels clamp inside the lane so the first
    // isn't glued to the boundary and the last clears the duration handle
    // (audit F23).
    const tickCount = 10
    const laneRight = width / dpr - HANDLE_HIT
    for (let i = 0; i <= tickCount; i++) {
      const t = (doc.duration / tickCount) * i
      const x = timeToX(t, width / dpr)
      ctx.fillStyle = colorBorder
      ctx.fillRect(x * dpr, 0, 1, HEADER_HEIGHT * dpr)
      const label = `${(t / 1000).toFixed(1)}s`
      const labelW = ctx.measureText(label).width / dpr
      let lx = x + 4
      if (lx < LABEL_WIDTH + 2) lx = LABEL_WIDTH + 2
      if (lx + labelW > laneRight - 2) lx = laneRight - 2 - labelW
      ctx.fillStyle = colorText
      ctx.fillText(label, lx * dpr, (HEADER_HEIGHT / 2) * dpr)
    }
    // Minor ticks at 1/50 of the duration, 4px tall (audit F23).
    for (let i = 1; i < MINOR_TICKS; i++) {
      if (i % (MINOR_TICKS / tickCount) === 0) continue // skip majors
      const t = (doc.duration / MINOR_TICKS) * i
      const x = timeToX(t, width / dpr)
      ctx.fillStyle = colorBorder
      ctx.fillRect(x * dpr, 0, 1, 4 * dpr)
    }

    ctx.font = `bold ${10 * dpr}px monospace`
    ctx.textAlign = 'right'
    ctx.fillStyle = colorPrimary
    ctx.fillText(`${doc.duration}ms`, width - (HANDLE_HIT + 4) * dpr, (HEADER_HEIGHT / 2) * dpr)
    ctx.textAlign = 'left'

    const handleX = width - (HANDLE_HIT * dpr) / 2
    ctx.fillStyle = colorPrimary
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
    ctx.strokeStyle = colorPrimary
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

    let row = 0
    doc.layers.forEach((layer) => {
      layer.tracks.forEach((track, ti) => {
        const y = (HEADER_HEIGHT + row * TRACK_HEIGHT) * dpr
        ctx.fillStyle = selectedLayerId() === layer.id ? 'hsl(220 12% 15%)' : colorBg
        ctx.fillRect(0, y, width, TRACK_HEIGHT * dpr)
        ctx.fillStyle = colorBorder
        ctx.fillRect(0, y + TRACK_HEIGHT * dpr - 1, width, 1)
        ctx.fillStyle = colorText
        ctx.font = `${10 * dpr}px monospace`
        ctx.textBaseline = 'middle'
        ctx.fillText(`${layer.name} / ${track.property}`, 8 * dpr, y + (TRACK_HEIGHT / 2) * dpr)
        ctx.fillStyle = colorBorder
        ctx.fillRect(LABEL_WIDTH * dpr, y + (TRACK_HEIGHT / 2) * dpr, width - LABEL_WIDTH * dpr, 1)
        track.keyframes.forEach((kf) => {
          const x = timeToX(kf.time, width / dpr) * dpr
          const cy2 = y + (TRACK_HEIGHT / 2) * dpr
          const isSelected = selectedKeyframeId() === kf.id
          const isHovered =
            hoverKf !== null &&
            hoverKf.layerId === layer.id &&
            hoverKf.trackId === track.id &&
            hoverKf.kfId === kf.id
          ctx.save()
          ctx.translate(x, cy2)
          ctx.rotate(Math.PI / 4)
          // Hover scales 1.3× (F10b/F25); selected reads as white + accent ring;
          // every diamond carries a 1px bg outline so it stays crisp on all
          // four track colors (F25).
          const r = KF_RADIUS * dpr * (isHovered ? 1.3 : 1)
          const color = trackColors[ti % trackColors.length]
          ctx.fillStyle = isSelected ? '#fff' : color
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
        row++
      })
    })

    // Playhead (audit F24): rounded grabbable cap, glow while scrubbing,
    // time bubble during drags. The line itself stays a 2px accent hairline.
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
    // Rounded head cap sitting in the ruler.
    const capR = 4 * dpr
    const capY = Math.min(10 * dpr, (HEADER_HEIGHT / 2) * dpr)
    ctx.beginPath()
    ctx.arc(ph, capY, capR, 0, Math.PI * 2)
    ctx.fillStyle = colorAccent
    ctx.fill()
    ctx.lineWidth = 1.5 * dpr
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
    const minX = LABEL_WIDTH * dpr
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

  /** Number of track rows drawn below the ruler header. */
  function totalTrackRows() {
    let rows = 0
    for (const layer of doc.layers) rows += layer.tracks.length
    return rows
  }

  function resize() {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.parentElement!.getBoundingClientRect()
    // Grow beyond the visible panel when there are more rows than fit, so the
    // container can scroll vertically instead of clipping tracks.
    const contentHeight = HEADER_HEIGHT + totalTrackRows() * TRACK_HEIGHT + CONTENT_PAD_BOTTOM
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
    let row = 0
    for (const layer of doc.layers) {
      for (const track of layer.tracks) {
        const ry = HEADER_HEIGHT + row * TRACK_HEIGHT
        const cy = ry + TRACK_HEIGHT / 2
        if (Math.abs(y - cy) < TRACK_HEIGHT / 2) {
          for (const kf of track.keyframes) {
            const kx = timeToX(kf.time, canvas!.offsetWidth)
            if (Math.abs(x - kx) < KF_RADIUS + 8) {
              return { layerId: layer.id, trackId: track.id, kfId: kf.id }
            }
          }
        }
        row++
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
    resizingDuration = false
    draggingKf = null
    scrubbing = false
    activePointerId = null
    // Ghost chip tracks the cursor; drop it with the gesture so it never
    // lingers where the pointer no longer is.
    ghostX = null
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
      setPlayhead(xToTime(x, canvas!.offsetWidth))
      return
    }
    const hit = hitTestKeyframe(x, y)
    if (hit) {
      draggingKf = hit
      // Selecting a keyframe also selects its layer so the Inspector,
      // which gates on the layer selection, shows the owning tracks.
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
      setPlayhead(xToTime(x, canvas!.offsetWidth))
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
      setPlayhead(xToTime(x, canvas!.offsetWidth))
    }
    // Touch keeps its small-movement slop so sloppy taps don't nudge keyframes.
    if (draggingKf && (downPointerType !== 'touch' || movedPastSlop)) {
      updateKeyframe(draggingKf.layerId, draggingKf.trackId, draggingKf.kfId, {
        time: Math.round(xToTime(x, canvas!.offsetWidth)),
      })
    }
    if (activePointerId === null) {
      // Hover-only state: zone cursor, hovered diamond, ghost chip (F10/F25).
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
    const msPerPx = doc.duration / (canvas!.offsetWidth - LABEL_WIDTH)
    setPlayhead((prev) => Math.max(0, Math.min(doc.duration, prev + e.deltaX * msPerPx)))
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
  )
}
