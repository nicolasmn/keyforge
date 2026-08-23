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

export default function Timeline() {
  let canvas: HTMLCanvasElement | undefined
  let raf: number
  let draggingKf: { layerId: string; trackId: string; kfId: string } | null = null
  let scrubbing = false
  let resizingDuration = false
  let touchStartX = 0
  let touchStartY = 0
  let touchMoved = false

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
    const tickCount = 10
    for (let i = 0; i <= tickCount; i++) {
      const t = (doc.duration / tickCount) * i
      const x = timeToX(t, width / dpr)
      ctx.fillStyle = colorBorder
      ctx.fillRect(x * dpr, 0, 1, HEADER_HEIGHT * dpr)
      ctx.fillStyle = colorText
      ctx.fillText(`${(t / 1000).toFixed(1)}s`, x * dpr + 4, (HEADER_HEIGHT / 2) * dpr)
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
          ctx.save()
          ctx.translate(x, cy2)
          ctx.rotate(Math.PI / 4)
          const color = trackColors[ti % trackColors.length]
          ctx.fillStyle = isSelected ? '#fff' : color
          const r = KF_RADIUS * dpr
          ctx.fillRect(-r / 2, -r / 2, r, r)
          ctx.restore()
        })
        row++
      })
    })

    const ph = timeToX(playhead(), width / dpr) * dpr
    ctx.fillStyle = colorAccent
    ctx.fillRect(ph, 0, 2 * dpr, height)
    ctx.beginPath()
    ctx.moveTo(ph - 6 * dpr, 0)
    ctx.lineTo(ph + 6 * dpr, 0)
    ctx.lineTo(ph, 10 * dpr)
    ctx.fill()
  }

  function resize() {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.parentElement!.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    draw()
  }

  function cssX(e: MouseEvent | Touch) {
    return e.clientX - canvas!.getBoundingClientRect().left
  }

  function cssY(e: MouseEvent | Touch) {
    return e.clientY - canvas!.getBoundingClientRect().top
  }

  function isOverHandle(x: number) {
    return x >= canvas!.offsetWidth - HANDLE_HIT
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

  function onMouseDown(e: MouseEvent) {
    const x = cssX(e)
    const y = cssY(e)
    if (y < HEADER_HEIGHT) {
      if (isOverHandle(x)) {
        resizingDuration = true
        setPlaying(false)
        canvas!.style.cursor = 'grabbing'
        return
      }
      scrubbing = true
      setPlaying(false)
      setPlayhead(xToTime(x, canvas!.offsetWidth))
      canvas!.style.cursor = 'grabbing'
      return
    }
    const hit = hitTestKeyframe(x, y)
    if (hit) {
      draggingKf = hit
      // Selecting a keyframe also selects its layer so the Inspector —
      // which gates on the layer selection — shows this keyframe's tracks.
      setSelectedKeyframeId(hit.kfId)
      setSelectedLayerId(hit.layerId)
      canvas!.style.cursor = 'grabbing'
    } else {
      setPlaying(false)
      setPlayhead(xToTime(x, canvas!.offsetWidth))
    }
  }

  function onMouseMove(e: MouseEvent) {
    const x = cssX(e)
    const y = cssY(e)
    // An active gesture (scrub / duration resize / keyframe drag) reads as
    // "grabbing" until it ends.
    if (resizingDuration || scrubbing || draggingKf) {
      canvas!.style.cursor = 'grabbing'
    } else if (y < HEADER_HEIGHT) {
      // Hovering the playhead ruler or the duration handle: open-hand affordance.
      canvas!.style.cursor = 'grab'
    } else {
      canvas!.style.cursor = ''
    }
    if (resizingDuration) {
      applyDurationFromX(x)
      return
    }
    if (scrubbing) setPlayhead(xToTime(x, canvas!.offsetWidth))
    if (draggingKf) {
      updateKeyframe(draggingKf.layerId, draggingKf.trackId, draggingKf.kfId, {
        time: Math.round(xToTime(x, canvas!.offsetWidth)),
      })
    }
  }

  function onMouseUp(e?: MouseEvent) {
    resizingDuration = false
    draggingKf = null
    scrubbing = false
    // Gesture over → fall back to the hover affordance under the pointer.
    if (canvas && e) canvas.style.cursor = cssY(e) < HEADER_HEIGHT ? 'grab' : ''
  }

  function onDblClick(e: MouseEvent) {
    const x = cssX(e)
    const y = cssY(e)
    if (y < HEADER_HEIGHT && isOverHandle(x)) {
      promptDuration()
    }
  }

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    touchStartX = cssX(t)
    touchStartY = cssY(t)
    touchMoved = false
    if (touchStartY < HEADER_HEIGHT) {
      if (isOverHandle(touchStartX)) {
        resizingDuration = true
        setPlaying(false)
        return
      }
      scrubbing = true
      setPlaying(false)
      setPlayhead(xToTime(touchStartX, canvas!.offsetWidth))
    }
  }

  function onTouchMove(e: TouchEvent) {
    e.preventDefault()
    const t = e.touches[0]
    const x = cssX(t)
    const y = cssY(t)
    if (Math.abs(x - touchStartX) > TOUCH_SLOP || Math.abs(y - touchStartY) > TOUCH_SLOP)
      touchMoved = true
    if (resizingDuration) {
      applyDurationFromX(x)
      return
    }
    if (scrubbing) {
      setPlayhead(xToTime(x, canvas!.offsetWidth))
      return
    }
    if (draggingKf) {
      updateKeyframe(draggingKf.layerId, draggingKf.trackId, draggingKf.kfId, {
        time: Math.round(xToTime(x, canvas!.offsetWidth)),
      })
      return
    }
    if (touchMoved) {
      const hit = hitTestKeyframe(touchStartX, touchStartY)
      if (hit) {
        draggingKf = hit
        // Same dual selection as the mouse path: keyframe + its layer.
        setSelectedKeyframeId(hit.kfId)
        setSelectedLayerId(hit.layerId)
      }
    }
  }

  function onTouchEnd(e: TouchEvent) {
    if (!touchMoved) {
      if (touchStartY < HEADER_HEIGHT && isOverHandle(touchStartX)) {
        promptDuration()
      } else {
        const hit = hitTestKeyframe(touchStartX, touchStartY)
        if (hit) {
          // Same dual selection as the mouse path: keyframe + its layer.
          setSelectedKeyframeId(hit.kfId)
          setSelectedLayerId(hit.layerId)
        } else if (touchStartY >= HEADER_HEIGHT) {
          setPlaying(false)
          setPlayhead(xToTime(touchStartX, canvas!.offsetWidth))
        }
      }
    }
    draggingKf = null
    scrubbing = false
    resizingDuration = false
    touchMoved = false
    e.preventDefault()
  }

  function setCanvasRef(el: HTMLCanvasElement) {
    canvas = el
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
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

  onCleanup(() => cancelAnimationFrame(raf))

  return (
    <div class="timeline">
      <canvas
        ref={setCanvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDblClick={onDblClick}
      />
    </div>
  )
}
