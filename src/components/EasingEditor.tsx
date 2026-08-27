/**
 * EasingEditor — the app's SINGLE easing-editor instance (plan §3/§4).
 *
 * Mounted by Inspector into a body portal, anchored to whichever easing
 * chip (or timeline diamond) opened it via components/easingPopover.ts.
 * Replaces the old inline KeyframeRow expansion that shoved ~700px of
 * editor below the row (friction F1) with a floating ~320px popover.
 *
 * Layout per plan §4 ASCII spec:
 *   [Curve][Spring] tabs + header actions
 *   → preview lane (loops current value; generalized from the old
 *     spring-only ball demo so EVERY easing gets motion preview — F3)
 *   → shared curve canvas (adaptive y-scale; bezier or spring plot)
 *   → tab body: Curve = numeric P1/P2 fields + grouped visual preset
 *     grid · Spring = perceptual sliders + spring preset chips
 *   → footer: raw input (demoted escape hatch, visible invalid state —
 *     F9) + copy + collapsible save form
 *
 * Commit contract (#68 dial parity — F8):
 *   - Handle DRAGS preview locally (canvas/raw text update per move) and
 *     write to the store EXACTLY ONCE on release; Escape mid-drag cancels.
 *   - Spring sliders preview while dragging and commit once on release;
 *     "Use spring curve" is gone (F6: one mental model).
 *   - Keyboard nudges / preset clicks / numeric edits commit immediately,
 *     matching the pre-existing immediate-commit surfaces (#84 audit).
 */
import { createSignal, createEffect, on, createMemo, onMount, onCleanup, For, Show } from 'solid-js'
import { BUILTIN_PRESETS, parseCubicBezier, evalCubicBezier } from '@/utils/easing-presets'
import { customEasings, addEasing, removeEasing } from '@/store/easingLibrary'
import { doc, theme, updateKeyframe } from '@/store'
import {
  paddedExtent,
  formatBezier,
  resolveBuiltin,
  builtinNameFor,
  type BezierHandles,
} from '@/utils/easingCurve'
import type { EasingPopoverTarget } from './easingPopover'
import { EasingCurveChip } from './EasingCurveChip'
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
  target: EasingPopoverTarget
  onClose: () => void
}

const CANVAS_CSS = 120
/** Loop period of the preview lane for non-spring values (ms). */
const BASE_DEMO_MS = 900

type EditorMode = 'curve' | 'spring'

/** Preset taxonomy for the visual grid (plan §4 zone 4). Derived from
 *  names so BUILTIN_PRESETS stays untouched for other consumers. */
const PRESET_GROUPS: { id: string; label: string; match: (name: string) => boolean }[] = [
  {
    id: 'standard',
    label: 'Standard',
    match: (n) =>
      n === 'linear' || n === 'ease' || n === 'ease-in' || n === 'ease-out' || n === 'ease-in-out',
  },
  { id: 'inout', label: 'In · Out', match: (n) => /-(quad|cubic)$/.test(n) },
  {
    id: 'back',
    label: 'Back · Overshoot',
    match: (n) => n.includes('-back') || ['anticipate', 'overshoot', 'settle'].includes(n),
  },
]

const NUM_FIELDS: { idx: 0 | 1 | 2 | 3; label: string }[] = [
  { idx: 0, label: 'P1x' },
  { idx: 1, label: 'P1y' },
  { idx: 2, label: 'P2x' },
  { idx: 3, label: 'P2y' },
]

/** Spring presets rendered as visual chips need their generated linear()
 *  string once at module load (5 × ~50 samples — trivial). */
const SPRING_PRESET_ITEMS = Object.values(SPRING_PRESETS).map((p) => ({
  label: p.label,
  perceptual: p.perceptual,
  value: generateSpringLinear(perceptualToConfig(p.perceptual)),
}))

export default function EasingEditor(props: Props) {
  let canvas: HTMLCanvasElement | undefined
  let rootEl: HTMLDivElement | undefined

  // ── Store resolution (reactive; survives row reordering underneath) ────
  const kf = () => {
    const layer = doc.layers.find((l) => l.id === props.target.layerId)
    return layer?.tracks
      .find((t) => t.id === props.target.trackId)
      ?.keyframes.find((k) => k.id === props.target.keyframeId)
  }

  // ── Draft state ─────────────────────────────────────────────────────────
  const [rawInput, setRawInput] = createSignal('')
  const [handles, setHandles] = createSignal<BezierHandles | null>(null)
  const [activeHandle, setActiveHandle] = createSignal<0 | 1 | 2>(1)
  const [mode, setMode] = createSignal<EditorMode>('curve')
  const [presetsOpen, setPresetsOpen] = createSignal(true)
  const [copied, setCopied] = createSignal(false)
  const [fieldDraft, setFieldDraft] = createSignal<Partial<Record<0 | 1 | 2 | 3, string>>>({})
  const [saveOpen, setSaveOpen] = createSignal(false)
  const [saveName, setSaveName] = createSignal('')
  const [saveError, setSaveError] = createSignal('')
  const [springDuration, setSpringDuration] = createSignal(450)
  const [springBounce, setSpringBounce] = createSignal(0.2)
  const [springPreview, setSpringPreview] = createSignal<string | null>(null)
  /** True while the user shapes the spring via presets/sliders — shows the
   *  live spring curve on the canvas even before/without committing. */
  const [springLive, setSpringLive] = createSignal(false)
  /** Wall-clock ms matching the simulated settle window of the preview. */
  const [springDemoMs, setSpringDemoMs] = createSignal(600)
  /** Flipped on discrete changes to restart the preview-lane loop. */
  const [animAlt, setAnimAlt] = createSignal(false)
  const [pos, setPos] = createSignal({ left: 0, top: 0 })

  /** Value this instance last wrote (or seeded from) — skips no-op writes. */
  let lastWritten = ''
  /** Non-reactive drag state (mirrors RotationDial's plain-flag model). */
  let dragging: 0 | 1 | 2 = 0
  /** Pre-drag snapshot for the #68 Escape-cancel contract. */
  let preDrag: { h: BezierHandles | null; raw: string; live: boolean } | null = null

  function resolveBezier(value: string): BezierHandles | null {
    const direct = parseCubicBezier(value)
    if (direct) return direct
    const named = resolveBuiltin(value)
    return named ? parseCubicBezier(named) : null
  }

  // ── Commit path (single funnel; no-op writes are skipped) ──────────────
  function commitEasing(v: string) {
    if (v === lastWritten) return
    lastWritten = v
    updateKeyframe(props.target.layerId, props.target.trackId, props.target.keyframeId, {
      easing: v,
    })
  }

  // ── Seeding (initial mount + retarget A→B) ──────────────────────────────
  function seedFromCommitted() {
    const v = kf()?.easing ?? 'linear'
    lastWritten = v
    setRawInput(v)
    setHandles(resolveBezier(v))
    setActiveHandle(1)
    setFieldDraft({})
    setSaveOpen(false)
    setSaveName('')
    setSaveError('')
    setCopied(false)
    setSpringLive(false)
    // linear() values auto-select the Spring tab (plan §4 zone 2).
    setMode(/^linear\s*\(/.test(v.trim()) ? 'spring' : 'curve')
    regenerateSpring(false)
  }
  // Re-seed when the popover retargets to a different keyframe.
  createEffect(
    on(
      () => props.target.keyframeId,
      () => seedFromCommitted(),
    ),
  )

  // Graceful close when the keyframe vanishes (delete / track removal).
  createEffect(() => {
    if (!kf()) props.onClose()
  })

  // ── Spring shaping ──────────────────────────────────────────────────────
  function applySpringParams(p: PerceptualSpring) {
    setSpringDuration(p.visualDurationMs)
    setSpringBounce(p.bounce)
  }

  /** Local-only regeneration of the generated-linear() preview from the
   *  current sliders. interacting=false seeds text without flipping the
   *  canvas into live-spring mode. */
  function regenerateSpring(interacting = true) {
    const cfg = perceptualToConfig({
      visualDurationMs: springDuration(),
      bounce: springBounce(),
    })
    setSpringPreview(generateSpringLinear(cfg))
    setSpringDemoMs(Math.round(Math.min(settleTime(cfg) * 1.05, 10) * 1000))
    if (!interacting) return
    setHandles(null)
    setSpringLive(true)
  }

  /** Slider RELEASE → exactly one store write (#68 parity; kills "Use
   *  spring curve" as a second mental model — plan M1 item 2). */
  function commitSpring() {
    const curve = springPreview()
    if (!curve) return
    setRawInput(curve)
    commitEasing(curve)
    setAnimAlt((v) => !v)
  }

  function applySpringPreset(item: (typeof SPRING_PRESET_ITEMS)[number]) {
    applySpringParams(item.perceptual)
    regenerateSpring()
    setRawInput(item.value)
    commitEasing(item.value)
    setAnimAlt((v) => !v)
  }

  // ── Spring sampling for the canvas ─────────────────────────────────────
  type CurvePoint = [progress: number, value: number]
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
    const m = rawInput().match(/linear\s*\(([^)]*)\)/)
    if (!m) return null
    const stops = parseLinearEasing(m[1])
    if (!stops || stops.length < 2) return null
    const span = stops[stops.length - 1].progress || 1
    return stops.map((s) => [s.progress / span, s.position])
  }

  // ── Raw-value classification (F9: visible invalid state, steps hint) ───
  type RawClass = 'bezier' | 'named' | 'linear' | 'steps' | 'invalid'
  function classify(v: string): RawClass {
    const t = v.trim()
    if (!t) return 'invalid'
    if (/^steps\s*\(/.test(t)) return 'steps'
    if (parseCubicBezier(t)) return 'bezier'
    if (resolveBuiltin(t)) return 'named'
    if (/^linear\s*\(/.test(t)) {
      const m = t.match(/linear\s*\(([^)]*)\)/)!
      const stops = parseLinearEasing(m[1])
      return stops && stops.length >= 2 ? 'linear' : 'invalid'
    }
    return 'invalid'
  }
  const rawInvalid = () => classify(rawInput()) === 'invalid'

  function onRawInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value
    setRawInput(v)
    const cls = classify(v)
    if (cls === 'bezier') {
      setHandles(parseCubicBezier(v.trim()))
      setSpringLive(false)
      commitEasing(v)
    } else if (cls === 'named' || cls === 'linear') {
      setHandles(null)
      setSpringLive(false)
      commitEasing(v)
    }
    // steps()/invalid: no commit, keep last-good handles drawn (F9).
    draw()
  }

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(rawInput())
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard blocked (sandboxed iframe) — silently ignore */
    }
  }

  // ── Canvas draw (ported from the inline editor; y-scale margin math now
  //    delegates to utils/easingCurve.paddedExtent so every surface shares
  //    the same overshoot framing semantics as chips/glyphs) ──────────────
  function bezierYScale(): { lo: number; hi: number } {
    const h = handles()
    if (!h) return { lo: 0, hi: 1 }
    return paddedExtent(Math.min(0, h[1], h[3]), Math.max(1, h[1], h[3]))
  }

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

    // Adaptive vertical scale (see bezierYScale/paddedExtent): identity
    // framing while handles stay in [0,1], expands for anticipation/settle.
    const ys = bezierYScale()
    function toCanvas(x: number, y: number): [number, number] {
      return [pad + x * inner, pad + (1 - (y - ys.lo) / (ys.hi - ys.lo)) * inner]
    }

    // Spring preview wins while active (user shaping a spring or an applied
    // linear() easing) — otherwise fall back to bezier handles / straight.
    const sp = springPoints()
    const h = handles()
    if (sp) {
      drawSpringCurve(ctx, sp, { pad, inner, W, dpr, colorPrimary, colorMuted })
    } else if (h) {
      const [x1, y1, x2, y2] = h
      // Overshoot guides: when zoomed out vertically, mark the original 0
      // and 1 value levels (same convention as the spring plot).
      if (ys.hi > 1 || ys.lo < 0) {
        ctx.strokeStyle = colorMuted
        ctx.lineWidth = 1 * dpr
        ctx.setLineDash([3 * dpr, 3 * dpr])
        for (const level of [0, 1]) {
          const [, gy] = toCanvas(0, level)
          ctx.beginPath()
          ctx.moveTo(pad, gy)
          ctx.lineTo(W - pad, gy)
          ctx.stroke()
        }
        ctx.setLineDash([])
      }

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

  /** Plot a sampled spring (progress→value) with bezier line styling. */
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
    const margin = Math.max(hi - lo, 0.001) * 0.08
    lo -= margin
    hi += margin
    const yOf = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * inner

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

  // ── Hit-testing / pointer transforms ────────────────────────────────────
  function cssToHandle(clientX: number, clientY: number): [number, number] {
    const rect = canvas!.getBoundingClientRect()
    const pad = 12
    const inner = CANVAS_CSS - pad * 2
    const s = bezierYScale()
    // X clamps to [0,1] per the cubic-bezier spec; Y allows the full
    // anticipation/settle range regardless of how far the view is zoomed.
    const x = Math.max(0, Math.min(1, (clientX - rect.left - pad) / inner))
    const yRaw = s.lo + (1 - (clientY - rect.top - pad) / inner) * (s.hi - s.lo)
    const y = Math.max(-0.5, Math.min(1.5, yRaw))
    return [x, y]
  }

  function handleToCss(nx: number, ny: number): [number, number] {
    const pad = 12
    const inner = CANVAS_CSS - pad * 2
    const s = bezierYScale()
    return [pad + nx * inner, pad + (1 - (ny - s.lo) / (s.hi - s.lo)) * inner]
  }

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

  // ── Handle drags: #68 dial contract ────────────────────────────────────
  // Local preview during gesture (handles + raw text + canvas redraw),
  // exactly ONE store write on release, Escape restores the pre-drag state.

  /** Local-only preview — never touches the store. */
  function previewHandles(next: BezierHandles) {
    setHandles(next)
    setSpringLive(false)
    setRawInput(formatBezier(next))
    draw()
  }

  function onCanvasPointerDown(e: PointerEvent) {
    const rect = canvas!.getBoundingClientRect()
    const hit = hitHandle(e.clientX - rect.left, e.clientY - rect.top)
    if (!hit || !handles()) return
    dragging = hit
    setActiveHandle(hit)
    preDrag = { h: handles(), raw: rawInput(), live: springLive() }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onCanvasPointerMove(e: PointerEvent) {
    if (!dragging || !preDrag) return
    const [x, y] = cssToHandle(e.clientX, e.clientY)
    const h = handles()!
    previewHandles(dragging === 1 ? [x, y, h[2], h[3]] : [h[0], h[1], x, y])
  }

  function endDrag(commit: boolean) {
    if (!dragging) return
    const snap = preDrag
    dragging = 0
    preDrag = null
    if (!commit || !snap) return
    // One deliberate write per gesture — only when the value moved.
    const final = rawInput()
    if (final !== snap.raw && classify(final) === 'bezier') {
      commitEasing(final)
      setAnimAlt((v) => !v)
    }
  }

  /** Escape mid-drag: discard the local preview, restore pre-drag state. */
  function cancelDrag() {
    if (!dragging || !preDrag) {
      dragging = 0
      preDrag = null
      return
    }
    const snap = preDrag
    dragging = 0
    preDrag = null
    setHandles(snap.h)
    setRawInput(snap.raw)
    setSpringLive(snap.live)
    draw()
  }

  // ── Keyboard nudges (immediate-commit surface, unchanged semantics) ────
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
    let [x, y]: number[] = ah === 1 ? [h[0], h[1]] : [h[2], h[3]]
    if (e.key === 'ArrowLeft') x -= step
    else if (e.key === 'ArrowRight') x += step
    else if (e.key === 'ArrowUp') y += step
    else if (e.key === 'ArrowDown') y -= step
    else return
    e.preventDefault()
    x = clampAxis(x, 0, 1)
    y = clampAxis(y, -0.5, 1.5)
    const next: BezierHandles = ah === 1 ? [x, y, h[2], h[3]] : [h[0], h[1], x, y]
    previewHandles(next)
    commitEasing(formatBezier(next))
    setAnimAlt((v) => !v)
  }

  // ── Numeric P1/P2 fields bound both ways (plan §4 zone 3) ──────────────
  const fmtNum = (v: number | undefined) => (v === undefined ? '' : String(+v.toFixed(3)))

  function onNumField(idx: 0 | 1 | 2 | 3, text: string) {
    setFieldDraft((d) => ({ ...d, [idx]: text }))
    const n = Number(text)
    if (!Number.isFinite(n)) return
    const h = handles()
    if (!h) return
    const clampLo = idx % 2 === 0 ? 0 : -0.5
    const clampHi = idx % 2 === 0 ? 1 : 1.5
    const v = Math.max(clampLo, Math.min(clampHi, n))
    const next: BezierHandles = [...h] as BezierHandles
    next[idx] = v
    previewHandles(next)
    commitEasing(formatBezier(next))
  }

  // ── Preset application ──────────────────────────────────────────────────
  /** Exact-match + normalized-bezier active detection (plan M1 item 3). */
  function normalizedEasing(v: string): string {
    const canon = resolveBuiltin(v) ?? v.trim()
    const b = parseCubicBezier(canon)
    return b ? formatBezier(b) : canon.replace(/\s+/g, '')
  }

  function applyPreset(value: string) {
    setRawInput(value)
    setHandles(resolveBezier(value))
    setSpringLive(false)
    commitEasing(value)
    setAnimAlt((v) => !v)
    // Collapsed-by-default after first pick so the canvas dominates (§4.4).
    setPresetsOpen(false)
  }

  const groupedPresets = createMemo(() =>
    PRESET_GROUPS.map((g) => ({
      ...g,
      items: BUILTIN_PRESETS.filter((p) => g.match(p.name)),
    })).filter((g) => g.items.length > 0),
  )

  // ── Save-to-library flow (header ⭐ → inline footer form, plan §6.2) ───
  function suggestName(): string {
    const nm = builtinNameFor(rawInput())
    const family = nm ?? 'custom'
    const count = customEasings().filter((e) => e.name.startsWith(`${family}-`)).length
    return `${family}-${count + 1}`
  }

  function toggleSaveForm() {
    setSaveOpen((open) => {
      if (!open) setSaveName(suggestName())
      setSaveError('')
      return !open
    })
  }

  function onSave() {
    const name = saveName().trim()
    if (!name) {
      setSaveError('Name required')
      return
    }
    const value = rawInput()
    if (value !== 'linear' && !parseCubicBezier(value) && !/^linear\s*\(/.test(value)) {
      setSaveError('Invalid easing value')
      return
    }
    addEasing(name, value)
    setSaveName('')
    setSaveError('')
    setSaveOpen(false)
  }

  function onSaveKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSave()
    } else if (e.key === 'Escape') {
      setSaveName('')
      setSaveError('')
      setSaveOpen(false)
    }
  }

  // ── Popover placement (flip above + clamp within viewport) ─────────────
  const POP_W_ESTIMATE = 320
  const POP_H_ESTIMATE = 480
  function reposition() {
    const a = props.target.anchor
    const w = rootEl?.offsetWidth ?? POP_W_ESTIMATE
    const h = rootEl?.offsetHeight ?? POP_H_ESTIMATE
    let left = a.x + 14
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    let top = a.y + 22
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.y - h - 12)
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8))
    setPos({ left, top })
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────
  onMount(() => {
    seedFromCommitted()
    reposition()

    // Uniform Escape contract (#48), scoped to the single instance:
    // closes from ANY focus except typing surfaces (their native Escape
    // wins); mid-drag Escape cancels the drag instead (#68).
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (dragging) {
        e.preventDefault()
        cancelDrag()
        return
      }
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      e.preventDefault()
      props.onClose()
    }
    window.addEventListener('keydown', onWindowKeyDown)

    // Light focus containment (plan §8 popover QA): Tab cycles inside the
    // popover instead of wandering into the occluded panel behind it.
    const FOCUSABLE =
      'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    const onRootKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !rootEl) return
      const items = [...rootEl.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      let next: HTMLElement | undefined
      if (e.shiftKey) next = active === first || !rootEl.contains(active) ? last : first
      else next = active === last || !rootEl.contains(active) ? first : undefined
      // Natural forward tab within the surface needs no intervention.
      if (!next) return
      e.preventDefault()
      next.focus()
    }
    rootEl?.addEventListener('keydown', onRootKeyDown)

    // Outside-click dismiss: clicks outside the popover AND outside any
    // easing chip (chips toggle themselves via their own handler). Using
    // the bubbling phase (not capture) so chip click handlers fire first
    // and can retarget the popover before this listener closes it.
    const onDocPointerDown = (e: PointerEvent) => {
      if (dragging) return
      const t = e.target as HTMLElement | null
      if (!t) return
      if (rootEl?.contains(t)) return
      if (t.closest('[data-easing-chip]')) return
      props.onClose()
    }
    document.addEventListener('pointerdown', onDocPointerDown)

    const onWinResize = () => reposition()
    window.addEventListener('resize', onWinResize)

    // Refine placement whenever the popover's own box resizes (presets
    // collapse, tab bodies differ) without reactive-tracking loops.
    let ro: ResizeObserver | undefined
    if (rootEl && 'ResizeObserver' in window) {
      ro = new ResizeObserver(() => reposition())
      ro.observe(rootEl)
    }

    onCleanup(() => {
      window.removeEventListener('keydown', onWindowKeyDown)
      rootEl?.removeEventListener('keydown', onRootKeyDown)
      document.removeEventListener('pointerdown', onDocPointerDown)
      window.removeEventListener('resize', onWinResize)
      ro?.disconnect()
      // Focus restore fires ONLY here (true close), not on retarget:
      // retargeting swaps target props without disposing this component.
      // Null-guarded: teardown may race the target signal clearing.
      const t = props.target as EasingPopoverTarget | null | undefined
      t?.restoreFocus?.()
    })

    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = CANVAS_CSS * dpr
    canvas.height = CANVAS_CSS * dpr
    canvas.style.width = `${CANVAS_CSS}px`
    canvas.style.height = `${CANVAS_CSS}px`
    setTimeout(() => canvas?.focus({ preventScroll: true }), 0)
    draw()
  })

  createEffect(() => {
    handles()
    rawInput()
    springLive()
    springDuration()
    springBounce()
    mode()
    void theme() // repaint on theme flip — curve colors come from CSS vars
    draw()
  })

  // Retarget → re-anchor near the new chip/diamond. (Fine-grained box-size
  // refinements ride the ResizeObserver registered in onMount.)
  createEffect(() => {
    void props.target.keyframeId
    queueMicrotask(reposition)
  })

  // ── Render helpers ──────────────────────────────────────────────────────
  const demoValue = () => (springLive() && springPreview() ? springPreview()! : rawInput())
  const demoMs = () => (springLive() ? springDemoMs() : BASE_DEMO_MS)

  function canvasAriaLabel(): string {
    if (springPoints())
      return 'Easing curve editor. Spring (linear()) curve preview — shape it with the spring sliders.'
    if (handles())
      return `Easing curve editor. Arrow keys move handle ${activeHandle()} (press 1 or 2 to switch, Shift for bigger steps). Handles may move above the top or below the bottom of the unit box for anticipation and overshoot curves.`
    return 'Easing curve editor. Linear curve — paste a cubic-bezier value in the field below.'
  }

  return (
    <div
      ref={rootEl}
      class="easing-popover"
      style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
      role="dialog"
      aria-label="Easing editor"
    >
      <div class="easing-editor">
        {/* Header: mode tabs + actions */}
        <div class="easing-editor__header">
          <div class="easing-editor__tabs" role="tablist">
            <button
              class="easing-editor__tab"
              classList={{ 'easing-editor__tab--active': mode() === 'curve' }}
              role="tab"
              aria-selected={mode() === 'curve'}
              onClick={() => setMode('curve')}
            >
              Curve
            </button>
            <button
              class="easing-editor__tab"
              classList={{ 'easing-editor__tab--active': mode() === 'spring' }}
              role="tab"
              aria-selected={mode() === 'spring'}
              onClick={() => setMode('spring')}
            >
              Spring
            </button>
          </div>
          <span class="easing-editor__spacer" />
          <button
            class="btn btn--ghost easing-editor__action"
            classList={{ 'easing-editor__action--on': saveOpen() }}
            onClick={toggleSaveForm}
            title="Save to library"
            aria-label="Save to library"
          >
            ★
          </button>
          <button
            class="btn btn--ghost easing-editor__action"
            onClick={() => props.onClose()}
            aria-label="Close easing editor"
          >
            ✕
          </button>
        </div>

        {/* Preview zone — motion feedback for EVERY easing (F3). The dot
            rides a CSS animation whose timing-function IS the edited value;
            timing-function changes apply live during drags, and discrete
            changes restart via animation-name flip. */}
        <div class="easing-editor__preview-row">
          <div class="easing-editor__preview" aria-hidden="true">
            <span
              class="easing-editor__preview-dot"
              style={{
                'animation-name': animAlt() ? 'kf-easing-run-a' : 'kf-easing-run-b',
                'animation-duration': `${demoMs()}ms`,
                'animation-timing-function': demoValue(),
                'animation-iteration-count': 'infinite',
                'animation-fill-mode': 'both',
              }}
            />
          </div>
          <Show when={mode() === 'spring' && springPreview()}>
            <code class="easing-editor__spring-out" title={springPreview() ?? undefined}>
              {springPreview()?.slice(0, 40)}…
            </code>
          </Show>
        </div>

        {/* Shared curve canvas */}
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
            onPointerUp={() => endDrag(true)}
            onLostPointerCapture={() => endDrag(true)}
            onKeyDown={onCanvasKeyDown}
          />
        </div>

        {/* Tab body */}
        <Show
          when={mode() === 'curve'}
          fallback={
            <div class="easing-editor__spring">
              <div class="easing-editor__presets easing-editor__presets--visual">
                <For each={SPRING_PRESET_ITEMS}>
                  {(item) => (
                    <button
                      class="easing-editor__preset easing-editor__preset--visual"
                      onClick={() => applySpringPreset(item)}
                      title={`Spring: ${item.label} — ${item.value}`}
                    >
                      <EasingCurveChip value={item.value} width={44} height={18} />
                      <span>{item.label}</span>
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
                      regenerateSpring() // local preview — NO store write
                    }}
                    onChange={() => commitSpring()} // release → ONE write
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
                    onChange={() => commitSpring()}
                  />
                  <em>{Math.round(springBounce() * 100)}%</em>
                </label>
              </div>
            </div>
          }
        >
          {/* Numeric fields bound both ways with the handles */}
          <div class="easing-editor__nums" classList={{ 'easing-editor__nums--off': !handles() }}>
            <For each={NUM_FIELDS}>
              {(f) => (
                <label class="easing-editor__num">
                  <span>{f.label}</span>
                  <input
                    type="number"
                    step="0.01"
                    disabled={!handles()}
                    value={fieldDraft()[f.idx] ?? fmtNum(handles()?.[f.idx])}
                    onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
                    onInput={(e) => onNumField(f.idx, (e.currentTarget as HTMLInputElement).value)}
                    onBlur={() =>
                      setFieldDraft((d) => {
                        const next = { ...d }
                        delete next[f.idx]
                        return next
                      })
                    }
                    aria-label={`Control point ${f.label}`}
                  />
                </label>
              )}
            </For>
          </div>

          {/* Grouped visual preset grid (collapsible) */}
          <div class="easing-editor__section-label">
            <button
              class="easing-editor__presets-toggle"
              onClick={() => setPresetsOpen((v) => !v)}
              aria-expanded={presetsOpen()}
              title="Toggle presets"
            >
              Presets <span class="easing-editor__chevron">{presetsOpen() ? '▾' : '▸'}</span>
            </button>
          </div>
          <Show when={presetsOpen()}>
            <For each={groupedPresets()}>
              {(g) => (
                <>
                  <div class="easing-editor__group-label">{g.label}</div>
                  <div class="easing-editor__presets easing-editor__presets--visual">
                    <For each={g.items}>
                      {(preset) => (
                        <button
                          class="easing-editor__preset easing-editor__preset--visual"
                          classList={{
                            'easing-editor__preset--active':
                              normalizedEasing(rawInput()) === normalizedEasing(preset.value),
                          }}
                          onClick={() => applyPreset(preset.value)}
                          title={`${preset.name} — ${preset.value}`}
                        >
                          <EasingCurveChip value={preset.value} width={44} height={18} />
                          <span>{preset.name}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </>
              )}
            </For>

            {/* Saved library entries */}
            <Show when={customEasings().length > 0}>
              <div class="easing-editor__group-label">Saved</div>
              <div class="easing-editor__presets easing-editor__presets--visual">
                <For each={customEasings()}>
                  {(preset) => (
                    <span class="easing-editor__preset-wrap">
                      <button
                        class="easing-editor__preset easing-editor__preset--visual"
                        classList={{
                          'easing-editor__preset--active':
                            normalizedEasing(rawInput()) === normalizedEasing(preset.value),
                        }}
                        onClick={() => applyPreset(preset.value)}
                        title={`${preset.name} — ${preset.value}`}
                      >
                        <EasingCurveChip value={preset.value} width={44} height={18} />
                        <span>{preset.name}</span>
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
          </Show>
        </Show>

        {/* Footer: hints + raw input + copy + save form */}
        <Show when={classify(rawInput()) === 'steps'}>
          <p class="easing-editor__hint">
            steps() easings render as straight lines until stop-graph editing lands (Phase L4).
          </p>
        </Show>
        <Show when={rawInvalid()}>
          <p class="easing-editor__hint easing-editor__hint--error">
            Not a parseable easing — keeping the last good curve.
          </p>
        </Show>
        <div class="easing-editor__footer">
          <input
            class="input easing-editor__raw-input"
            classList={{ 'easing-editor__raw-input--invalid': rawInvalid() }}
            value={rawInput()}
            onInput={onRawInput}
            spellcheck={false}
            aria-label="Easing value"
            aria-invalid={rawInvalid()}
          />
          <button
            class="btn btn--ghost easing-editor__action"
            onClick={copyRaw}
            title="Copy value"
            aria-label="Copy easing value"
          >
            {copied() ? '✓' : '⧉'}
          </button>
        </div>
        <Show when={saveOpen()}>
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
              ref={(el) => setTimeout(() => el.focus(), 0)}
              aria-label="Easing preset name"
            />
            <button class="btn btn--primary easing-editor__save-btn" onClick={onSave}>
              Save
            </button>
          </div>
          <Show when={saveError()}>
            <p class="easing-editor__save-error">{saveError()}</p>
          </Show>
        </Show>
      </div>
    </div>
  )
}
