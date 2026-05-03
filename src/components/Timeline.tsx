import { createEffect, onCleanup, onMount } from 'solid-js'
import {
  doc,
  playhead,
  setPlayhead,
  setPlaying,
  selectedLayerId,
  selectedKeyframeId,
  setSelectedKeyframeId,
  updateKeyframe,
} from '@/store'

const TRACK_HEIGHT = 32
const HEADER_HEIGHT = 28
const LABEL_WIDTH = 120
const KF_RADIUS = 6

export default function Timeline() {
  let canvas: HTMLCanvasElement | undefined
  let raf: number
  let draggingKf: { layerId: string; trackId: string; kfId: string } | null = null
  let scrubbing = false

  function timeToX(time: number, width: number) {
    return LABEL_WIDTH + (time / doc.duration) * (width - LABEL_WIDTH)
  }

  function xToTime(x: number, width: number) {
    return Math.max(
      0,
      Math.min(doc.duration, ((x - LABEL_WIDTH) / (width - LABEL_WIDTH)) * doc.duration),
    )
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
    const trackColors = [
      cssVars.getPropertyValue('--color-track-1').trim(),
      cssVars.getPropertyValue('--color-track-2').trim(),
      cssVars.getPropertyValue('--color-track-3').trim(),
      cssVars.getPropertyValue('--color-track-4').trim(),
    ]

    // Background
    ctx.fillStyle = colorBg
    ctx.fillRect(0, 0, width, height)

    // Time ruler
    ctx.fillStyle = colorBorder
    ctx.fillRect(0, 0, width, HEADER_HEIGHT)
    ctx.fillStyle = colorText
    ctx.font = `${11 * dpr}px monospace`
    ctx.textBaseline = 'middle'
    const tickCount = 10
    for (let i = 0; i <= tickCount; i++) {
      const t = (doc.duration / tickCount) * i
      const x = timeToX(t, width)
      ctx.fillStyle = colorBorder
      ctx.fillRect(x, 0, 1, HEADER_HEIGHT)
      ctx.fillStyle = colorText
      ctx.fillText(`${(t / 1000).toFixed(1)}s`, x + 4, HEADER_HEIGHT / 2)
    }

    // Tracks
    let row = 0
    doc.layers.forEach((layer) => {
      layer.tracks.forEach((track, ti) => {
        const y = HEADER_HEIGHT + row * TRACK_HEIGHT
        ctx.fillStyle = selectedLayerId() === layer.id ? 'hsl(220 12% 15%)' : colorBg
        ctx.fillRect(0, y, width, TRACK_HEIGHT)
        ctx.fillStyle = colorBorder
        ctx.fillRect(0, y + TRACK_HEIGHT - 1, width, 1)
        ctx.fillStyle = colorText
        ctx.font = `${10 * dpr}px monospace`
        ctx.textBaseline = 'middle'
        ctx.fillText(`${layer.name} / ${track.property}`, 8, y + TRACK_HEIGHT / 2)
        ctx.fillStyle = colorBorder
        ctx.fillRect(LABEL_WIDTH, y + TRACK_HEIGHT / 2, width - LABEL_WIDTH, 1)
        track.keyframes.forEach((kf) => {
          const x = timeToX(kf.time, width)
          const cy = y + TRACK_HEIGHT / 2
          const isSelected = selectedKeyframeId() === kf.id
          ctx.save()
          ctx.translate(x, cy)
          ctx.rotate(Math.PI / 4)
          const color = trackColors[ti % trackColors.length]
          ctx.fillStyle = isSelected ? '#fff' : color
          ctx.fillRect(-KF_RADIUS / 2, -KF_RADIUS / 2, KF_RADIUS, KF_RADIUS)
          ctx.restore()
        })
        row++
      })
    })

    // Playhead
    const ph = timeToX(playhead(), width)
    ctx.fillStyle = colorAccent
    ctx.fillRect(ph, 0, 2, height)
    ctx.beginPath()
    ctx.moveTo(ph - 6, 0)
    ctx.lineTo(ph + 6, 0)
    ctx.lineTo(ph, 10)
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
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    draw()
  }

  function getEventX(e: MouseEvent) {
    return (e.offsetX * (window.devicePixelRatio || 1)) / (window.devicePixelRatio || 1)
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
            if (Math.abs(x - kx) < KF_RADIUS + 4) {
              return { layerId: layer.id, trackId: track.id, kfId: kf.id }
            }
          }
        }
        row++
      }
    }
    return null
  }

  function onMouseDown(e: MouseEvent) {
    const x = getEventX(e)
    const y = e.offsetY
    if (y < HEADER_HEIGHT) {
      scrubbing = true
      setPlaying(false)
      setPlayhead(xToTime(x, canvas!.offsetWidth))
      return
    }
    const hit = hitTestKeyframe(x, y)
    if (hit) {
      draggingKf = hit
      setSelectedKeyframeId(hit.kfId)
    } else {
      setPlaying(false)
      setPlayhead(xToTime(x, canvas!.offsetWidth))
    }
  }

  function onMouseMove(e: MouseEvent) {
    const x = getEventX(e)
    if (scrubbing) {
      setPlayhead(xToTime(x, canvas!.offsetWidth))
    }
    if (draggingKf) {
      const newTime = Math.round(xToTime(x, canvas!.offsetWidth))
      updateKeyframe(draggingKf.layerId, draggingKf.trackId, draggingKf.kfId, { time: newTime })
    }
  }

  function onMouseUp() {
    draggingKf = null
    scrubbing = false
  }

  onMount(() => {
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas!.parentElement!)
    onCleanup(() => ro.disconnect())
  })

  createEffect(() => {
    void doc.layers.map((l) => l.tracks.map((t) => t.keyframes.map((k) => k.time)))
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
        ref={canvas}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
    </div>
  )
}
