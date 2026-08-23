import { createSignal, createEffect, onMount, For, Show } from 'solid-js'
import { BUILTIN_PRESETS, parseCubicBezier, evalCubicBezier } from '@/utils/easing-presets'
import { customEasings, addEasing, removeEasing } from '@/store/easingLibrary'
import {
  SPRING_PRESETS,
  perceptualToConfig,
  generateSpringLinear,
  parseLinearEasing,
  sampleSpring,
  settleTime,
  type PerceptualSpring,
} from '@/utils/spring'

interface Props {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

const CANVAS_CSS = 120

export default function EasingEditor(props: Props) {
  let canvas: HTMLCanvasElement | undefined
  // Wrap props.value in a getter so we read it reactively inside createEffect
  const initialValue = () => props.value
  /** Resolve named presets ('ease-out', …) to their canonical bezier so the
   *  canvas opens with real handles instead of an inert straight line. */
  function resolveBezier(value: string): [number, number, number, number] | null {
    const direct = parseCubicBezier(value)
    if (direct) return direct
    const named = BUILTIN_PRESETS.find((p) => p.name === value)
    return named ? parseCubicBezier(named.value) : null
  }
  const [rawInput, setRawInput] = createSignal(initialValue())
  const [handles, setHandles] = createSignal<[number, number, number, number] | null>(
    resolveBezier(initialValue()),
  )
  const [saveName, setSaveName] = createSignal('')
  const [saveError, setSaveError] = createSignal('')
  const [activeHandle, setActiveHandle] = createSignal<0 | 1 | 2>(1)
  const [springDuration, setSpringDuration] = createSignal(450)
  const [springBounce, setSpringBounce] = createSignal(0.2)
  const [springPreview, setSpringPreview] = createSignal<string | null>(null)
  /** True while the user is shaping the spring via presets/sliders — shows
   *  the live spring curve on the canvas even before it is applied. */
  const [springLive, setSpringLive] = createSignal(false)
  /** Wall-clock ms matching the simulated settle window of the preview. */
  const [springDemoMs, setSpringDemoMs] = createSignal(600)
  /** Flipped on every spring change to restart the ball demo animation
   *  (alternating between two identical keyframes). */
  const [springAnimAlt, setSpringAnimAlt] = createSignal(false)
  let dragging: 0 | 1 | 2 = 0

  function applySpring(p: PerceptualSpring) {
    setSpringDuration(p.visualDurationMs)
    setSpringBounce(p.bounce)
    regenerateSpring()
  }

  /** Recompute the generated linear() preview from the current sliders.
   *  Called with interacting=false on mount to seed the preview text and
   *  ball demo without flipping the canvas into live-spring mode. */
  function regenerateSpring(interacting = true) {
    const cfg = perceptualToConfig({
      visualDurationMs: springDuration(),
      bounce: springBounce(),
    })
    setSpringPreview(generateSpringLinear(cfg))
    setSpringDemoMs(Math.round(Math.min(settleTime(cfg) * 1.05, 10) * 1000))
    if (!interacting) return
    // Live spring shaping takes over the canvas; drop any bezier handles so
    // stale drag targets don't linger while the spring curve is shown.
    setHandles(null)
    setSpringLive(true)
    setSpringAnimAlt((v) => !v)
  }

  // ── Spring curve sampling ─────────────────────────────────────────────
  type CurvePoint = [progress: number, value: number]
  /** Live curve for the spring currently being shaped in the controls. */
  function liveSpringPoints(): CurvePoint[] {
    const cfg = perceptualToConfig({
      visualDurationMs: springDuration(),
      bounce: springBounce(),
    })
    const total = Math.min(settleTime(cfg) * 1.05, 10)
    const pts: CurvePoint[] = []
    for (let i = 0; i <= 60; i++) {
      const u = i / 60
      pts.push([u, sampleSpring(cfg, u * total)])
    }
    return pts
  }
  /**
   * Points to plot when a spring is on screen, or null. Priority:
   *  1. user is interacting with the Spring controls → live config;
   *  2. raw input is an applied linear(...) → parse its stops.
   */
  function springPoints(): CurvePoint[] | null {
    if (springLive()) return liveSpringPoints()
    const m = rawInput().match(/linear\(([^)]*)\)/)
    if (!m) return null
    const stops = parseLinearEasing(m[1])
    if (!stops || stops.length < 2) return null
    // Normalize progress against the last stop so legacy strings whose
    // percents don't reach 100% still plot across the full width.
    const span = stops[stops.length - 1].progress || 1
    return stops.map((s) => [s.progress / span, s.position])
  }

  // ── Canvas draw ────────────────────────────────────────────────────────
  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const W = CANVAS_CSS * dpr
    ctx.clearRect(0, 0, W, W)

    const cv = getComputedStyle(document.documentElement)
    const colorBg = cv.getPropertyValue('--color-surface-2').trim()
    const colorBorder = cv.getPropertyValue('--color-border').trim()
    const colorPrimary = cv.getPropertyValue('--color-accent').trim()
    const colorMuted = cv.getPropertyValue('--color-text-muted').trim()

    ctx.fillStyle = colorBg
    ctx.fillRect(0, 0, W, W)

    ctx.strokeStyle = colorBorder
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * W
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, W)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, p)
      ctx.lineTo(W, p)
      ctx.stroke()
    }

    const pad = 12 * dpr
    const inner = W - pad * 2

    function toCanvas(x: number, y: number): [number, number] {
      return [pad + x * inner, pad + (1 - y) * inner]
    }

    // Spring preview wins while active (user shaping a spring or an applied
    // linear() easing) — otherwise fall back to bezier handles / straight.
    const sp = springPoints()
    const h = handles()
    if (sp) {
      drawSpringCurve(ctx, sp, { pad, inner, W, dpr, colorPrimary, colorMuted })
    } else if (h) {
      const [x1, y1, x2, y2] = h
      const [hx1, hy1] = toCanvas(x1, y1)
      const [hx2, hy2] = toCanvas(x2, y2)
      const [p0x, p0y] = toCanvas(0, 0)
      const [p1x, p1y] = toCanvas(1, 1)

      ctx.strokeStyle = colorMuted
      ctx.lineWidth = 1 * dpr
      ctx.setLineDash([3 * dpr, 3 * dpr])
      ctx.beginPath()
      ctx.moveTo(p0x, p0y)
      ctx.lineTo(hx1, hy1)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(p1x, p1y)
      ctx.lineTo(hx2, hy2)
      ctx.stroke()
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

      const handlePts: [number, number][] = [
        [hx1, hy1],
        [hx2, hy2],
      ]
      handlePts.forEach(([hx, hy], i) => {
        const idx = i + 1
        ctx.beginPath()
        ctx.arc(hx, hy, idx === activeHandle() ? 6 * dpr : 4 * dpr, 0, Math.PI * 2)
        ctx.fillStyle = colorPrimary
        ctx.fill()
        if (idx === activeHandle()) {
          ctx.strokeStyle = colorMuted
          ctx.lineWidth = 1.5 * dpr
          ctx.stroke()
        }
      })
    } else {
      ctx.strokeStyle = colorPrimary
      ctx.lineWidth = 2 * dpr
      const [p0x, p0y] = toCanvas(0, 0)
      const [p1x, p1y] = toCanvas(1, 1)
      ctx.beginPath()
      ctx.moveTo(p0x, p0y)
      ctx.lineTo(p1x, p1y)
      ctx.stroke()
    }
  }

  /** Plot a sampled spring (progress→value) with bezier line styling.
   *  The y scale adapts so overshoot beyond [0,1] stays visible; dashed
   *  guides mark the 0 and 1 reference levels. Values are clamped to the
   *  canvas bounds. */
  function drawSpringCurve(
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    g: {
      pad: number
      inner: number
      W: number
      dpr: number
      colorPrimary: string
      colorMuted: string
    },
  ) {
    const { pad, inner, W, dpr, colorPrimary, colorMuted } = g
    let lo = 0
    let hi = 1
    for (const [, v] of pts) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    // Small margin so the extremes don't kiss the canvas edge.
    const margin = Math.max(hi - lo, 0.001) * 0.08
    lo -= margin
    hi += margin
    const yOf = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * inner

    // Reference lines at value 0 and 1.
    ctx.strokeStyle = colorMuted
    ctx.lineWidth = 1 * dpr
    ctx.setLineDash([3 * dpr, 3 * dpr])
    for (const level of [0, 1]) {
      const y = Math.max(0, Math.min(W, yOf(level)))
      ctx.beginPath()
      ctx.moveTo(pad, y)
      ctx.lineTo(W - pad, y)
      ctx.stroke()
    }
    ctx.setLineDash([])

    ctx.strokeStyle = colorPrimary
    ctx.lineWidth = 2 * dpr
    ctx.beginPath()
    pts.forEach(([x, v], i) => {
      const cx = pad + x * inner
      const cy = Math.max(0, Math.min(W, yOf(v)))
      if (i === 0) ctx.moveTo(cx, cy)
      else ctx.lineTo(cx, cy)
    })
    ctx.stroke()
  }

  // ── Hit-testing (CSS pixels) ────────────────────────────────────────────
  function cssToHandle(clientX: number, clientY: number): [number, number] {
    const rect = canvas!.getBoundingClientRect()
    const pad = 12
    const inner = CANVAS_CSS - pad * 2
    const x = Math.max(0, Math.min(1, (clientX - rect.left - pad) / inner))
    const y = Math.max(-0.5, Math.min(1.5, 1 - (clientY - rect.top - pad) / inner))
    return [x, y]
  }

  function handleToCss(nx: number, ny: number): [number, number] {
    const pad = 12
    const inner = CANVAS_CSS - pad * 2
    return [pad + nx * inner, pad + (1 - ny) * inner]
  }

  // ── Pointer events (mouse / touch / pen) ───────────────────────────────
  function hitHandle(mx: number, my: number): 0 | 1 | 2 {
    const h = handles()
    if (!h) return 0
    const [x1, y1, x2, y2] = h
    const [hx1, hy1] = handleToCss(x1, y1)
    const [hx2, hy2] = handleToCss(x2, y2)
    if (Math.hypot(mx - hx2, my - hy2) < 12) return 2
    if (Math.hypot(mx - hx1, my - hy1) < 12) return 1
    return 0
  }

  function onCanvasPointerDown(e: PointerEvent) {
    const rect = canvas!.getBoundingClientRect()
    const hit = hitHandle(e.clientX - rect.left, e.clientY - rect.top)
    if (!hit || !handles()) return
    dragging = hit
    setActiveHandle(hit)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function applyHandles(next: [number, number, number, number]) {
    setHandles(next)
    setSpringLive(false)
    const val = `cubic-bezier(${next.map((v) => +v.toFixed(3)).join(', ')})`
    setRawInput(val)
    props.onChange(val)
    draw()
  }

  function onCanvasPointerMove(e: PointerEvent) {
    if (!dragging) return
    const [x, y] = cssToHandle(e.clientX, e.clientY)
    const h = handles()!
    const next: [number, number, number, number] =
      dragging === 1 ? [x, y, h[2], h[3]] : [h[0], h[1], x, y]
    applyHandles(next)
  }

  function onCanvasPointerUp() {
    dragging = 0
  }

  // ── Keyboard support ───────────────────────────────────────────────────
  // Arrows nudge the active handle; 1/2 pick which handle is active.
  const NUDGE = 0.02
  function clampAxis(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v))
  }

  function onCanvasKeyDown(e: KeyboardEvent) {
    const h = handles()
    if (!h) return
    if (e.key === '1') {
      setActiveHandle(1)
      e.preventDefault()
      return
    }
    if (e.key === '2') {
      setActiveHandle(2)
      e.preventDefault()
      return
    }
    const step = e.shiftKey ? NUDGE * 5 : NUDGE
    const ah = activeHandle()
    if (ah === 0) return
    let [x, y] = ah === 1 ? [h[0], h[1]] : [h[2], h[3]]
    if (e.key === 'ArrowLeft') x -= step
    else if (e.key === 'ArrowRight') x += step
    else if (e.key === 'ArrowUp') y += step
    else if (e.key === 'ArrowDown') y -= step
    else return
    e.preventDefault()
    x = clampAxis(x, 0, 1)
    y = clampAxis(y, -0.5, 1.5)
    const next: [number, number, number, number] =
      ah === 1 ? [x, y, h[2], h[3]] : [h[0], h[1], x, y]
    applyHandles(next)
  }

  // ── Raw input ──────────────────────────────────────────────────────────
  function onRawInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value
    setRawInput(v)
    const parsed = parseCubicBezier(v)
    if (parsed) {
      setHandles(parsed)
      setSpringLive(false)
      props.onChange(v)
    } else if (v === 'linear') {
      setHandles(null)
      setSpringLive(false)
      props.onChange(v)
    }
    draw()
  }

  // ── Preset / library ──────────────────────────────────────────────────
  function applyPreset(value: string) {
    setRawInput(value)
    setHandles(resolveBezier(value))
    setSpringLive(false)
    props.onChange(value)
    draw()
  }

  // ── Save to library ──────────────────────────────────────────────────
  function onSave() {
    const name = saveName().trim()
    if (!name) {
      setSaveError('Name required')
      return
    }
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
    if (e.key === 'Enter') {
      e.preventDefault()
      onSave()
    } else if (e.key === 'Escape') {
      setSaveName('')
      setSaveError('')
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  onMount(() => {
    regenerateSpring(false)
    // Kick off the ambient ball demo once (subsequent param changes retrigger
    // it by flipping the animation-name).
    setSpringAnimAlt((v) => !v)
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = CANVAS_CSS * dpr
    canvas.height = CANVAS_CSS * dpr
    canvas.style.width = `${CANVAS_CSS}px`
    canvas.style.height = `${CANVAS_CSS}px`
    draw()
  })

  createEffect(() => {
    handles()
    rawInput()
    springLive()
    springDuration()
    springBounce()
    draw()
  })

  // ── Render ─────────────────────────────────────────────────────────────
  function canvasAriaLabel(): string {
    if (springPoints())
      return 'Easing curve editor. Spring (linear()) curve preview — shape it with the spring controls below.'
    if (handles())
      return `Easing curve editor. Arrow keys move handle ${activeHandle()} (press 1 or 2 to switch, Shift for bigger steps).`
    return 'Easing curve editor. Linear curve — paste a cubic-bezier value to edit handles.'
  }

  return (
    <div class="easing-editor">
      {/* Canvas + raw input row */}
      <div class="easing-editor__canvas-wrap">
        <canvas
          ref={(el) => {
            canvas = el
          }}
          class="easing-editor__canvas"
          tabIndex={0}
          role="application"
          aria-label={canvasAriaLabel()}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onLostPointerCapture={onCanvasPointerUp}
          onKeyDown={onCanvasKeyDown}
        />
        <div class="easing-editor__raw">
          <input
            class="input easing-editor__raw-input"
            value={rawInput()}
            onInput={onRawInput}
            spellcheck={false}
            aria-label="Easing value"
          />
          {/* Wrap handler in arrow fn to satisfy solid/reactivity for prop access */}
          <button
            class="btn btn--ghost easing-editor__close"
            onClick={() => props.onClose()}
            aria-label="Close easing editor"
          >
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

      {/* Spring (linear()) generator */}
      <div class="easing-editor__section-label">Spring</div>
      <div class="easing-editor__spring">
        <div class="easing-editor__presets">
          <For each={Object.entries(SPRING_PRESETS)}>
            {([, preset]) => (
              <button
                class="easing-editor__preset"
                onClick={() => applySpring(preset.perceptual)}
                title={`Spring: ${preset.label}`}
              >
                {preset.label}
              </button>
            )}
          </For>
        </div>
        <div class="easing-editor__spring-params">
          <label class="easing-editor__spring-param">
            <span>Duration</span>
            <input
              type="range"
              min="150"
              max="1200"
              step="10"
              value={springDuration()}
              onInput={(e) => {
                setSpringDuration(Number((e.currentTarget as HTMLInputElement).value))
                regenerateSpring()
              }}
            />
            <em>{springDuration()}ms</em>
          </label>
          <label class="easing-editor__spring-param">
            <span>Bounce</span>
            <input
              type="range"
              min="0"
              max="0.9"
              step="0.05"
              value={springBounce()}
              onInput={(e) => {
                setSpringBounce(Number((e.currentTarget as HTMLInputElement).value))
                regenerateSpring()
              }}
            />
            <em>{Math.round(springBounce() * 100)}%</em>
          </label>
        </div>
        <Show when={springPreview()}>
          <div class="easing-editor__spring-demo-row">
            {/* Ball demo: dot slides left→right using the generated
                linear() easing; animation-name alternates between two
                identical keyframes to retrigger on every param change. */}
            <div class="easing-editor__spring-demo" aria-hidden="true">
              <span
                class="easing-editor__spring-dot"
                style={{
                  'animation-name': springAnimAlt() ? 'kf-easing-spring-a' : 'kf-easing-spring-b',
                  'animation-duration': `${springDemoMs()}ms`,
                  'animation-timing-function': springPreview() ?? undefined,
                  'animation-iteration-count': 'infinite',
                  'animation-fill-mode': 'both',
                }}
              />
            </div>
            <code class="easing-editor__spring-out" title={springPreview() ?? undefined}>
              {springPreview()?.slice(0, 72)}…
            </code>
          </div>
        </Show>
        <button
          class="btn btn--ghost easing-editor__spring-apply"
          onClick={() => {
            const curve = springPreview()
            if (curve) {
              setRawInput(curve)
              setHandles(null)
              props.onChange(curve)
            }
          }}
          disabled={!springPreview()}
        >
          Use spring curve
        </button>
      </div>

      {/* Save form */}
      <div class="easing-editor__save-row">
        <input
          class="input easing-editor__save-input"
          placeholder="Name…"
          value={saveName()}
          onInput={(e) => {
            setSaveName((e.currentTarget as HTMLInputElement).value)
            setSaveError('')
          }}
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
