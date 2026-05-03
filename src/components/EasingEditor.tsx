import { createSignal, createEffect, onMount, For, Show } from 'solid-js'
import { BUILTIN_PRESETS, parseCubicBezier, evalCubicBezier } from '@/utils/easing-presets'
import { customEasings, addEasing, removeEasing } from '@/store/easingLibrary'

interface Props {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

const CANVAS_CSS = 120

export default function EasingEditor(props: Props) {
  let canvas: HTMLCanvasElement | undefined
  const [rawInput,   setRawInput]   = createSignal(props.value)
  const [handles,    setHandles]    = createSignal<[number, number, number, number] | null>(
    parseCubicBezier(props.value),
  )
  const [saveName,   setSaveName]   = createSignal('')
  const [saveError,  setSaveError]  = createSignal('')
  let dragging: 0 | 1 | 2 = 0

  // ── Canvas draw ────────────────────────────────────────────────────────
  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const W = CANVAS_CSS * dpr
    ctx.clearRect(0, 0, W, W)

    const cv = getComputedStyle(document.documentElement)
    const colorBg      = cv.getPropertyValue('--color-surface-2').trim()
    const colorBorder  = cv.getPropertyValue('--color-border').trim()
    const colorPrimary = cv.getPropertyValue('--color-primary').trim()
    const colorMuted   = cv.getPropertyValue('--color-text-muted').trim()

    ctx.fillStyle = colorBg
    ctx.fillRect(0, 0, W, W)

    ctx.strokeStyle = colorBorder
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * W
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, W); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(W, p); ctx.stroke()
    }

    const pad   = 12 * dpr
    const inner = W - pad * 2

    function toCanvas(x: number, y: number): [number, number] {
      return [pad + x * inner, pad + (1 - y) * inner]
    }

    const h = handles()
    if (h) {
      const [x1, y1, x2, y2] = h
      const [hx1, hy1] = toCanvas(x1, y1)
      const [hx2, hy2] = toCanvas(x2, y2)
      const [p0x, p0y] = toCanvas(0, 0)
      const [p1x, p1y] = toCanvas(1, 1)

      ctx.strokeStyle = colorMuted
      ctx.lineWidth = 1 * dpr
      ctx.setLineDash([3 * dpr, 3 * dpr])
      ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(hx1, hy1); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(hx2, hy2); ctx.stroke()
      ctx.setLineDash([])

      ctx.strokeStyle = colorPrimary
      ctx.lineWidth = 2 * dpr
      ctx.beginPath()
      ctx.moveTo(p0x, p0y)
      for (let i = 1; i <= 60; i++) {
        const t = i / 60
        const yv = evalCubicBezier(t, h)
        const [cx, cy] = toCanvas(t, yv)
        ctx.lineTo(cx, cy)
      }
      ctx.stroke()

      for (const [hx, hy] of [[hx1, hy1], [hx2, hy2]]) {
        ctx.beginPath()
        ctx.arc(hx, hy, 4 * dpr, 0, Math.PI * 2)
        ctx.fillStyle = colorPrimary
        ctx.fill()
      }
    } else {
      ctx.strokeStyle = colorPrimary
      ctx.lineWidth = 2 * dpr
      const [p0x, p0y] = toCanvas(0, 0)
      const [p1x, p1y] = toCanvas(1, 1)
      ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.stroke()
    }
  }

  // ── Hit-testing (CSS pixels) ────────────────────────────────────────────
  function cssToHandle(clientX: number, clientY: number): [number, number] {
    const rect  = canvas!.getBoundingClientRect()
    const pad   = 12
    const inner = CANVAS_CSS - pad * 2
    const x = Math.max(0,    Math.min(1,   (clientX - rect.left - pad) / inner))
    const y = Math.max(-0.5, Math.min(1.5, 1 - (clientY - rect.top - pad) / inner))
    return [x, y]
  }

  function handleToCss(nx: number, ny: number): [number, number] {
    const pad   = 12
    const inner = CANVAS_CSS - pad * 2
    return [pad + nx * inner, pad + (1 - ny) * inner]
  }

  // ── Mouse events ───────────────────────────────────────────────────────
  function onCanvasMouseDown(e: MouseEvent) {
    const h = handles()
    if (!h) return
    const rect = canvas!.getBoundingClientRect()
    const [x1, y1, x2, y2] = h
    const [hx1, hy1] = handleToCss(x1, y1)
    const [hx2, hy2] = handleToCss(x2, y2)
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    if (Math.hypot(mx - hx1, my - hy1) < 12) dragging = 1
    else if (Math.hypot(mx - hx2, my - hy2) < 12) dragging = 2
  }

  function onCanvasMouseMove(e: MouseEvent) {
    if (!dragging) return
    const [x, y] = cssToHandle(e.clientX, e.clientY)
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

  // ── Raw input ──────────────────────────────────────────────────────────
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

  // ── Preset click ───────────────────────────────────────────────────────
  function applyPreset(value: string) {
    setRawInput(value)
    setHandles(parseCubicBezier(value))
    props.onChange(value)
    draw()
  }

  // ── Save to library ────────────────────────────────────────────────────
  function onSave() {
    const name = saveName().trim()
    if (!name) { setSaveError('Name required'); return }
    const value = rawInput()
    if (value !== 'linear' && !parseCubicBezier(value)) {
      setSaveError('Invalid easing value')
      return
    }
    addEasing(name, value)
    setSaveName('')
    setSaveError('')
  }

  function onSaveKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); onSave() }
    else if (e.key === 'Escape') { setSaveName(''); setSaveError('') }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  onMount(() => {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width  = CANVAS_CSS * dpr
    canvas.height = CANVAS_CSS * dpr
    canvas.style.width  = `${CANVAS_CSS}px`
    canvas.style.height = `${CANVAS_CSS}px`
    draw()
  })

  createEffect(() => { void handles(); draw() })

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div class="easing-editor">

      {/* Canvas + raw input row */}
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
            aria-label="Easing value"
          />
          <button class="btn btn--ghost easing-editor__close" onClick={props.onClose} aria-label="Close easing editor">
            ✕
          </button>
        </div>
      </div>

      {/* Built-in presets */}
      <div class="easing-editor__section-label">Built-in</div>
      <div class="easing-editor__presets">
        <For each={BUILTIN_PRESETS}>
          {(preset) => (
            <button
              class="easing-editor__preset"
              classList={{ 'easing-editor__preset--active': rawInput() === preset.value }}
              onClick={() => applyPreset(preset.value)}
              title={preset.value}
            >
              {preset.name}
            </button>
          )}
        </For>
      </div>

      {/* Custom library */}
      <Show when={customEasings().length > 0}>
        <div class="easing-editor__section-label">Saved</div>
        <div class="easing-editor__presets">
          <For each={customEasings()}>
            {(preset) => (
              <span class="easing-editor__preset-wrap">
                <button
                  class="easing-editor__preset"
                  classList={{ 'easing-editor__preset--active': rawInput() === preset.value }}
                  onClick={() => applyPreset(preset.value)}
                  title={preset.value}
                >
                  {preset.name}
                </button>
                <button
                  class="easing-editor__preset-delete"
                  onClick={() => removeEasing(preset.name)}
                  title={`Remove ${preset.name}`}
                  aria-label={`Remove ${preset.name}`}
                >
                  ✕
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* Save form */}
      <div class="easing-editor__save-row">
        <input
          class="input easing-editor__save-input"
          placeholder="Name…"
          value={saveName()}
          onInput={(e) => { setSaveName((e.currentTarget as HTMLInputElement).value); setSaveError('') }}
          onKeyDown={onSaveKeyDown}
          aria-label="Easing preset name"
        />
        <button class="btn btn--primary easing-editor__save-btn" onClick={onSave}>
          Save
        </button>
      </div>
      <Show when={saveError()}>
        <p class="easing-editor__save-error">{saveError()}</p>
      </Show>

    </div>
  )
}
