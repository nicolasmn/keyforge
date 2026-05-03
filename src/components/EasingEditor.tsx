import { createSignal, createEffect, onMount, For, Show } from 'solid-js'
import { EASING_PRESETS, parseCubicBezier, evalCubicBezier } from '@/utils/easing-presets'

interface Props {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

const CANVAS_SIZE = 120

export default function EasingEditor(props: Props) {
  let canvas: HTMLCanvasElement | undefined
  const [rawInput, setRawInput] = createSignal(props.value)
  const [handles, setHandles] = createSignal<[number, number, number, number] | null>(
    parseCubicBezier(props.value),
  )
  let dragging: 0 | 1 | 2 = 0 // 0=none, 1=handle1, 2=handle2

  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const s = CANVAS_SIZE
    const dpr = window.devicePixelRatio || 1
    const W = s * dpr
    ctx.clearRect(0, 0, W, W)

    const cssVars = getComputedStyle(document.documentElement)
    const colorBg = cssVars.getPropertyValue('--color-surface-2').trim()
    const colorBorder = cssVars.getPropertyValue('--color-border').trim()
    const colorPrimary = cssVars.getPropertyValue('--color-primary').trim()
    const colorMuted = cssVars.getPropertyValue('--color-text-muted').trim()

    ctx.fillStyle = colorBg
    ctx.fillRect(0, 0, W, W)

    // Grid
    ctx.strokeStyle = colorBorder
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * W
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, W); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(W, p); ctx.stroke()
    }

    const pad = 12 * dpr
    const innerW = W - pad * 2

    function toCanvas(x: number, y: number): [number, number] {
      return [pad + x * innerW, pad + (1 - y) * innerW]
    }

    const h = handles()
    if (h) {
      const [x1, y1, x2, y2] = h
      const [hx1, hy1] = toCanvas(x1, y1)
      const [hx2, hy2] = toCanvas(x2, y2)
      const [p0x, p0y] = toCanvas(0, 0)
      const [p1x, p1y] = toCanvas(1, 1)

      // Control lines
      ctx.strokeStyle = colorMuted
      ctx.lineWidth = 1 * dpr
      ctx.setLineDash([3 * dpr, 3 * dpr])
      ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(hx1, hy1); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(hx2, hy2); ctx.stroke()
      ctx.setLineDash([])

      // Curve
      ctx.strokeStyle = colorPrimary
      ctx.lineWidth = 2 * dpr
      ctx.beginPath()
      ctx.moveTo(p0x, p0y)
      for (let i = 1; i <= 60; i++) {
        const t = i / 60
        const y = evalCubicBezier(t, h)
        const [cx2, cy2] = toCanvas(t, y)
        ctx.lineTo(cx2, cy2)
      }
      ctx.stroke()

      // Handle dots
      for (const [hx, hy] of [[hx1, hy1], [hx2, hy2]]) {
        ctx.beginPath()
        ctx.arc(hx, hy, 4 * dpr, 0, Math.PI * 2)
        ctx.fillStyle = colorPrimary
        ctx.fill()
      }
    } else {
      // linear fallback
      ctx.strokeStyle = colorPrimary
      ctx.lineWidth = 2 * dpr
      const [p0x, p0y] = toCanvas(0, 0)
      const [p1x, p1y] = toCanvas(1, 1)
      ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.stroke()
    }
  }

  function canvasToHandle(ex: number, ey: number): [number, number] {
    const rect = canvas!.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const pad = 12
    const inner = CANVAS_SIZE - pad * 2
    const x = Math.max(0, Math.min(1, (ex - rect.left - pad) / inner))
    const y = Math.max(-0.5, Math.min(1.5, 1 - (ey - rect.top - pad) / inner))
    void dpr
    return [x, y]
  }

  function onCanvasMouseDown(e: MouseEvent) {
    const h = handles()
    if (!h) return
    const rect = canvas!.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const pad = 12
    const inner = CANVAS_SIZE - pad * 2
    const [x1, y1, x2, y2] = h
    const hx1 = pad + x1 * inner
    const hy1 = CANVAS_SIZE - (pad + y1 * inner)
    const hx2 = pad + x2 * inner
    const hy2 = CANVAS_SIZE - (pad + y2 * inner)
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const d1 = Math.hypot(mx - hx1, my - hy1)
    const d2 = Math.hypot(mx - hx2, my - hy2)
    void dpr
    if (d1 < 12) dragging = 1
    else if (d2 < 12) dragging = 2
  }

  function onCanvasMouseMove(e: MouseEvent) {
    if (!dragging) return
    const [x, y] = canvasToHandle(e.clientX, e.clientY)
    const h = handles()!
    const next: [number, number, number, number] = dragging === 1
      ? [x, y, h[2], h[3]]
      : [h[0], h[1], x, y]
    setHandles(next)
    const val = `cubic-bezier(${next.map((v) => +v.toFixed(3)).join(', ')})`
    setRawInput(val)
    props.onChange(val)
    draw()
  }

  function onCanvasMouseUp() { dragging = 0 }

  function onRawInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value
    setRawInput(v)
    const parsed = parseCubicBezier(v)
    if (parsed) {
      setHandles(parsed)
      props.onChange(v)
    } else if (v === 'linear') {
      setHandles(null)
      props.onChange(v)
    }
    draw()
  }

  function onPresetClick(value: string) {
    setRawInput(value)
    setHandles(parseCubicBezier(value))
    props.onChange(value)
    draw()
  }

  onMount(() => {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = CANVAS_SIZE * dpr
    canvas.height = CANVAS_SIZE * dpr
    canvas.style.width = `${CANVAS_SIZE}px`
    canvas.style.height = `${CANVAS_SIZE}px`
    draw()
  })

  createEffect(() => {
    void handles()
    draw()
  })

  return (
    <div class="easing-editor">
      <div class="easing-editor__canvas-wrap">
        <canvas
          ref={(el) => { canvas = el }}
          class="easing-editor__canvas"
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
        />
        <div class="easing-editor__raw">
          <input
            class="input easing-editor__raw-input"
            value={rawInput()}
            onInput={onRawInput}
            spellcheck={false}
          />
          <button class="btn btn--ghost easing-editor__close" onClick={props.onClose}>
            ✕
          </button>
        </div>
      </div>
      <div class="easing-editor__presets">
        <For each={EASING_PRESETS}>
          {(preset) => (
            <button
              class="easing-editor__preset"
              classList={{ 'easing-editor__preset--active': rawInput() === preset.value }}
              onClick={() => onPresetClick(preset.value)}
              title={preset.value}
            >
              {preset.name}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
