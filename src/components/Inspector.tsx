/**
 * Inspector — DevTools-style panel.
 *
 * Design decisions:
 * - UNCONTROLLED inputs: set value once on open, commit on blur/Enter/Tab/Escape.
 * - No drag-scrub anywhere. Numbers use type="number" + unit <select>.
 * - Transform args editable via tap → inline NumberUnitField per sub-token.
 * - Rotation values (deg/rad/turn/grad) show a small SVG dial preview.
 * - <datalist> rendered in a body portal to escape overflow:hidden clipping.
 * - autocomplete="on" + list= required for datalist on iOS Safari.
 *
 * BLUR BUG FIX:
 * onBlur on <input> fires when focus moves to the <select> inside the same
 * NumberUnitField. We use onFocusOut on the wrapper span and check
 * e.relatedTarget to see if focus stayed inside the component. Only commit
 * when focus truly left.
 */
import {
  createEffect,
  createSignal,
  createMemo,
  For,
  Show,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js'
import { render } from 'solid-js/web'
import {
  selectedLayerId,
  selectedKeyframeId,
  setSelectedKeyframeId,
  getSelectedLayer,
  getSelectedTrackAndKeyframe,
  addTrack,
  addKeyframe,
  updateKeyframe,
  removeKeyframe,
  removeTrack,
  playhead,
  doc,
} from '@/store'
import type {
  AnimatableProperty,
  EasingName,
  Keyframe,
  TokenPath,
  Track,
  ValueToken,
  SubToken,
} from '@/types'
import EasingEditor from './EasingEditor'
import OriginSection from './OriginSection'
import { RotationDial, NumberUnitField } from './fields'
import { tokenizeKeyframe, NUMBER_UNIT_RE } from '@/utils/tokenize'
import { setKeyframeSelectionSource, consumeKeyframeSelectionSource } from '@/utils/selectionSource'
import { completionsFor, isAngleUnit, toDeg, formatAngle } from '@/utils/cssCompletions'
import { scrubbedValue, clampToProperty } from '@/utils/scrub'
import {
  addTransformFn,
  removeTransformFn,
  moveTransformFn,
  ADDABLE_TRANSFORM_FNS,
} from '@/utils/transformStack'
import { easeAllTrackKeyframes, EASY_EASE_EASING } from '@/utils/easingAssistant'

const PROPERTIES: AnimatableProperty[] = [
  'opacity',
  'transform',
  'background-color',
  'color',
  'border-radius',
  'width',
  'height',
  'scale',
  'translate',
  'rotate',
]

// ── helpers ────────────────────────────────────────────────────────────────────

function commit(path: ValueToken['path'], value: string) {
  if (path.field === 'value') {
    updateKeyframe(path.layerId, path.trackId, path.keyframeId, { value })
  } else {
    updateKeyframe(path.layerId, path.trackId, path.keyframeId, {
      easing: value as EasingName,
    })
  }
}

function validate(type: ValueToken['type'], value: string): boolean {
  if (type === 'color') return CSS.supports('color', value)
  if (type === 'number') return NUMBER_UNIT_RE.test(value) || value === '' || !isNaN(Number(value))
  if (type === 'easing')
    return (
      value === 'linear' ||
      /^cubic-bezier\(/.test(value) ||
      /^steps\(/.test(value) ||
      /^linear\(/.test(value)
    )
  return value.length > 0
}

/** Enter/Space activation for chip-like spans that act as buttons (a11y).
 *  Ignores events from form fields — the inline edit input lives inside the
 *  chip span, and its keystrokes must not trigger activation or lose
 *  characters to preventDefault (e.g. spaces in cubic-bezier values). */
interface NudgeOptions {
  scrubValue?: string
  scrubUnit?: string
  onNudge?: (value: number) => void
  clampProperty?: AnimatableProperty
}

function chipKeyDown(e: KeyboardEvent, action: () => void, nudge?: NudgeOptions) {
  const target = e.target
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    action()
    return
  }
  // Arrow-key value nudge on focused number chips (registry-clamped).
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    const direction = e.key === 'ArrowUp' ? 1 : -1
    const magnitude = e.shiftKey ? 10 : 1
    // Sub-token chips carry an explicit nudge callback with their own value.
    if (nudge?.onNudge && nudge.scrubValue !== undefined) {
      const cur = Number.parseFloat(nudge.scrubValue)
      if (Number.isNaN(cur)) return
      const unit = nudge.scrubUnit ?? ''
      const step = direction * magnitude * (unit === '' ? 0.05 : 1)
      const next = clampToProperty(nudge.clampProperty, cur + step)
      nudge.onNudge(next)
      return
    }
    // Generic chips: read value from text, commit via data-path.
    const chip = e.currentTarget as HTMLElement
    const property = chip.dataset.property as AnimatableProperty | undefined
    const token = chip.textContent?.trim() ?? ''
    const m = NUMBER_UNIT_RE.exec(token)
    if (!m) return
    const step = direction * magnitude * (property === 'opacity' || property === 'scale' ? 0.05 : 1)
    const next = clampToProperty(property, Number.parseFloat(m[1]) + step)
    try {
      const path = JSON.parse(chip.dataset.path ?? '') as TokenPath
      if (path?.keyframeId) commit(path, `${next}${m[2] ?? ''}`)
    } catch {
      // malformed path — ignore
    }
  }
}

function mountDatalist(id: string, options: string[]): () => void {
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <datalist id={id}>
        <For each={options}>{(o) => <option value={o} />}</For>
      </datalist>
    ),
    host,
  )
  return () => {
    dispose()
    document.body.removeChild(host)
  }
}

// ── Color swatch ──────────────────────────────────────────────────────────────

/** Progressive enhancement: Chromium's Screen EyeDropper API. */
const EYE_DROPPER_SUPPORTED = typeof window !== 'undefined' && 'EyeDropper' in window

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }

function pickFromScreen(): Promise<string | null> {
  const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
  if (!Ctor) return Promise.resolve(null)
  return new Ctor()
    .open()
    .then((r: { sRGBHex: string }) => r.sRGBHex)
    .catch(() => null) // user cancelled
}

function ColorSwatch(props: { token: ValueToken }) {
  return (
    <span
      class="kf-chip__swatch"
      style={{ background: props.token.value }}
      title="Click to open the color picker"
      onClick={(e) => {
        e.stopPropagation()
        const tmp = document.createElement('div')
        tmp.style.color = props.token.value
        document.body.appendChild(tmp)
        const rgb = getComputedStyle(tmp).color
        document.body.removeChild(tmp)
        const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
        const inp = document.createElement('input')
        inp.type = 'color'
        if (m) {
          const h = (n: number) => n.toString(16).padStart(2, '0')
          inp.value = `#${h(+m[1])}${h(+m[2])}${h(+m[3])}`
        }
        inp.oninput = () => commit(props.token.path, inp.value)
        inp.onchange = () => commit(props.token.path, inp.value)
        inp.click()
      }}
    />
  )
}

// ── SubScrub: editable sub-token chip (transform arg) ─────────────────────────

function SubScrub(props: { sub: SubToken; parent: ValueToken; property?: AnimatableProperty }) {
  const [editing, setEditing] = createSignal(false)

  // Angle args (rotate/rotateX/…) get a live dial at rest (audit old-F8):
  // the transform chip previously had no angle affordance at all.
  const subDeg = () => {
    const unit = props.sub.unit || ''
    const n = Number.parseFloat(props.sub.value)
    return Number.isNaN(n) ? null : isAngleUnit(unit) ? toDeg(n, unit) : null
  }

  function commitSub(num: string, unit: string) {
    const n = parseFloat(num)
    if (!isNaN(n)) {
      const updated = props.parent.subTokens!.map((st) =>
        st.argIndex === props.sub.argIndex ? { ...st, value: String(n), unit } : st,
      ) as SubToken[]
      commit(props.parent.path, props.sub.assembler(updated))
    }
    setEditing(false)
  }

  return (
    <Show
      when={editing()}
      fallback={
        <span
          class="kf-chip kf-chip--number kf-chip--sub"
          tabindex={0}
          role="button"
          data-property={props.property}
          data-scrub-value={props.sub.value}
          data-scrub-unit={props.sub.unit}
          aria-label={`Edit value ${props.sub.value}${props.sub.unit}`}
          onClick={() => setEditing(true)}
          onKeyDown={(e: KeyboardEvent) =>
            chipKeyDown(e, () => setEditing(true), {
              scrubValue: props.sub.value,
              scrubUnit: props.sub.unit,
              onNudge: (v: number) => {
                commitSub(String(v), props.sub.unit || 'px')
              },
              clampProperty: props.property,
            })
          }
          title="Tap to edit · ↑↓ nudge"
        >
          {props.sub.value}
          {props.sub.unit}
          <Show when={subDeg() !== null}>
            <RotationDial
              deg={subDeg()!}
              onCommit={(d) => {
                // ONE write per gesture/keyboard nudge, formatted with
                // DevTools per-unit precision (integers for deg/grad,
                // ≤2dp turn / ≤4dp rad where round-trip allows).
                const unit = props.sub.unit || 'deg'
                commitSub(formatAngle(d, unit), unit)
              }}
            />
          </Show>
        </span>
      }
    >
      <NumberUnitField
        numStr={props.sub.value}
        unit={props.sub.unit || 'px'}
        property={props.property}
        onCommit={commitSub}
        onCancel={() => setEditing(false)}
      />
    </Show>
  )
}

// ── ValueChip ─────────────────────────────────────────────────────────────────

/** Hint shown on an EMPTY transform stack ('none' after deleting all fns).
 *  Surfaces the existing paste escape hatch alongside the (+) picker. */
const EMPTY_TRANSFORM_HINT =
  'No transform functions — click + to add one, or paste e.g. rotate(45deg)'

function ValueChip(props: { token: ValueToken; property?: AnimatableProperty }) {
  const [editing, setEditing] = createSignal(false)
  const [invalid, setInvalid] = createSignal(false)
  const [stackPickerOpen, setStackPickerOpen] = createSignal(false)
  let inputEl: HTMLInputElement | undefined
  let cleanupDl: (() => void) | null = null
  onCleanup(() => {
    cleanupDl?.()
  })

  // ── Safe scrubbing (mouse only; tap threshold preserves click-to-edit) ──
  let scrub: {
    startX: number
    startValue: number
    unit: string
    active: boolean
    raf: number
    pendingDx: number
    lastEvent: PointerEvent | null
  } | null = null
  let suppressClick = false

  function startScrub(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return // touch/pen keep tap-to-edit
    const { num, unit } = parsed()
    const startNum = Number.parseFloat(num)
    if (Number.isNaN(startNum)) return // non-numeric chips don't scrub
    scrub = {
      startX: e.clientX,
      startValue: startNum,
      unit,
      active: false,
      raf: 0,
      pendingDx: 0,
      lastEvent: e,
    }
    window.addEventListener('pointermove', onScrubMove)
    window.addEventListener('pointerup', onScrubEnd)
  }

  function onScrubMove(e: PointerEvent) {
    if (!scrub) return
    const dx = e.clientX - scrub.startX
    if (!scrub.active) {
      if (Math.abs(dx) < 4) return // below threshold → still a tap
      scrub.active = true
      document.body.style.cursor = 'ew-resize'
    }
    scrub.pendingDx = e.clientX - scrub.startX
    scrub.lastEvent = e
    if (!scrub.raf) {
      scrub.raf = requestAnimationFrame(() => {
        if (!scrub) return
        const next = clampToProperty(
          props.property,
          scrubbedValue(
            { startX: scrub.startX, startValue: scrub.startValue, unit: scrub.unit },
            scrub.pendingDx,
            { shift: scrub.lastEvent?.shiftKey, alt: scrub.lastEvent?.altKey },
          ),
        )
        commit(props.token.path, `${next}${scrub.unit}`)
        if (scrub) scrub.raf = 0
      })
    }
  }

  function onScrubEnd() {
    window.removeEventListener('pointermove', onScrubMove)
    window.removeEventListener('pointerup', onScrubEnd)
    if (scrub?.raf) cancelAnimationFrame(scrub.raf)
    // Latch: click fires AFTER pointerup, so a plain boolean reset too
    // early and the post-drag click opened the editor. Clear on next tick.
    if (scrub?.active) {
      suppressClick = true
      setTimeout(() => {
        suppressClick = false
      }, 0)
    }
    scrub = null
    document.body.style.cursor = ''
  }

  const dlId = `kf-dl-${Math.random().toString(36).slice(2)}`

  const parsed = () => {
    const m = NUMBER_UNIT_RE.exec(props.token.value)
    return m ? { num: m[1], unit: m[2] ?? '' } : { num: props.token.value, unit: '' }
  }

  const angleDeg = () => {
    if (props.token.type !== 'number') return null
    const { num, unit } = parsed()
    if (!isAngleUnit(unit)) return null
    return toDeg(parseFloat(num) || 0, unit)
  }

  // Group transform sub-tokens by their owning function so multi-function
  // values render as `fnA(a, b) fnB(c)` instead of one merged pseudo-function.
  // argIndex encodes fnIndex * 100 + argInFn (see tokenize.ts), which is
  // stable even when a function has non-numeric args that produce no chip.
  const transformGroups = () => {
    const subs = props.token.subTokens ?? []
    const names = [...props.token.value.matchAll(/([\w-]+)\(/g)].map((m) => m[1])
    const groups: { fi: number; fn: string; subs: SubToken[] }[] = []
    for (const st of subs) {
      const fi = Math.floor(st.argIndex / 100)
      const last = groups[groups.length - 1]
      if (last && last.fi === fi) last.subs.push(st)
      else groups.push({ fi, fn: names[fi] ?? '?', subs: [st] })
    }
    return groups
  }

  // Empty transform stack ('none' after deleting the last function): the
  // chip must stay transform-shaped with a reachable (+) picker instead of
  // falling through to the generic text branch, which dead-ended re-adding.
  const hasTransformFns = () => (props.token.subTokens?.length ?? 0) > 0

  function open() {
    if (props.token.type === 'transform') return
    if (!cleanupDl) {
      cleanupDl = mountDatalist(dlId, completionsFor(props.token.type, props.token.value))
    }
    setInvalid(false)
    setEditing(true)
  }

  function openIfIdle() {
    if (!editing()) open()
  }

  function close(revert = false) {
    if (!revert) {
      const raw = (inputEl?.value ?? props.token.value).trim()
      // Never commit empty/garbage: an empty declaration corrupts the
      // keyframe (exports literal `opacity:;`). Reverting to the previous
      // value matches DevTools semantics — invalid input cancels the edit.
      if (raw === '') {
        setInvalid(false)
        setEditing(false)
        return
      }
      if (validate(props.token.type, raw)) {
        commit(props.token.path, raw)
        setInvalid(false)
      } else {
        setInvalid(true)
        commit(props.token.path, props.token.value)
      }
    }
    setEditing(false)
  }

  function closeWithNum(num: string, unit: string) {
    if (num.trim() === '') {
      // empty number = cancelled edit, keep previous value
      setEditing(false)
      return
    }
    const value = `${num}${unit}`
    if (validate('number', value)) {
      commit(props.token.path, value)
      setInvalid(false)
    } else {
      setInvalid(true)
    }
    setEditing(false)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      close()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    }
    if (e.key === 'Tab') {
      close()
    }
  }

  function onInputChange(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value
    setInvalid(!validate(props.token.type, v))
  }

  return (
    <>
      {/* transform: sub-token chips, grouped per function, stack controls.
          Renders even for an EMPTY stack ('none' after delete-all): the
          "no functions" hint plus the always-visible (+) picker keep the
          add flow reachable instead of dead-ending in the text branch. */}
      <Show when={props.token.type === 'transform'}>
        <span
          class="kf-chip kf-chip--transform"
          title={hasTransformFns() ? undefined : EMPTY_TRANSFORM_HINT}
        >
          <For each={transformGroups()}>
            {(g, gi) => (
              <>
                <Show when={gi() > 0}>
                  <span class="kf-chip__sep"> </span>
                </Show>
                <span class="kf-chip__fn">{g.fn}(</span>
                <For each={g.subs}>
                  {(sub, i) => (
                    <>
                      <SubScrub sub={sub} parent={props.token} property={props.property} />
                      <Show when={i() < g.subs.length - 1}>
                        <span class="kf-chip__sep">, </span>
                      </Show>
                    </>
                  )}
                </For>
                <span class="kf-chip__fn">)</span>
                <button
                  class="kf-stack-btn"
                  title={`Remove ${g.fn}`}
                  aria-label={`Remove ${g.fn} from transform`}
                  onClick={(e) => {
                    e.stopPropagation()
                    const next = removeTransformFn(props.token.value, g.fi)
                    if (next !== props.token.value) commit(props.token.path, next)
                  }}
                >
                  ✕
                </button>
                <button
                  class="kf-stack-btn"
                  title={`Move ${g.fn} earlier`}
                  aria-label={`Move ${g.fn} earlier in the transform stack`}
                  disabled={gi() === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    const next = moveTransformFn(props.token.value, g.fi, -1)
                    if (next !== props.token.value) commit(props.token.path, next)
                  }}
                >
                  ◀
                </button>
              </>
            )}
          </For>
          <Show when={!hasTransformFns()}>
            <span class="kf-chip__empty">no functions</span>
          </Show>
          <button
            class="kf-stack-btn kf-stack-btn--add"
            title="Add a transform function"
            aria-label="Add a transform function"
            onClick={(e) => {
              e.stopPropagation()
              setStackPickerOpen((v) => !v)
            }}
          >
            +
          </button>
        </span>
        <Show when={stackPickerOpen()}>
          <div class="kf-stack-picker" role="menu">
            <For each={ADDABLE_TRANSFORM_FNS}>
              {(name) => (
                <button
                  class="kf-stack-picker__item"
                  role="menuitem"
                  onClick={() => {
                    const next = addTransformFn(props.token.value, name)
                    commit(props.token.path, next)
                    setStackPickerOpen(false)
                  }}
                >
                  {name}()
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* number: NumberUnitField when editing, labeled chip at rest */}
      <Show when={props.token.type === 'number'}>
        <Show
          when={editing()}
          fallback={
            <span
              class="kf-chip kf-chip--number"
              classList={{ 'kf-chip--error': invalid() }}
              tabindex={0}
              role="button"
              data-property={props.property}
              data-path={JSON.stringify(props.token.path)}
              aria-label={`Number value ${props.token.value}. Arrow keys nudge, Shift for ×10.`}
              onClick={() => {
                if (!suppressClick) open()
              }}
              onPointerDown={startScrub}
              onKeyDown={(e: KeyboardEvent) => chipKeyDown(e, openIfIdle)}
              title="Drag to scrub · ↑↓ nudge · tap to edit"
            >
              <span class="kf-chip__label">{props.token.value}</span>
              <Show when={angleDeg() !== null}>
                <RotationDial deg={angleDeg()!} />
              </Show>
            </span>
          }
        >
          <NumberUnitField
            numStr={parsed().num}
            unit={parsed().unit}
            property={props.property}
            onCommit={closeWithNum}
            onCancel={() => setEditing(false)}
          />
        </Show>
      </Show>

      {/* all other non-transform, non-number types */}
      <Show when={props.token.type !== 'transform' && props.token.type !== 'number'}>
        <span
          class="kf-chip"
          classList={{
            [`kf-chip--${props.token.type}`]: true,
            'kf-chip--editing': editing(),
            'kf-chip--error': editing() && invalid(),
          }}
          tabindex={0}
          role="button"
          data-property={props.token.type === 'number' ? props.property : undefined}
          data-path={JSON.stringify(props.token.path)}
          aria-label={`Edit ${props.token.type} value ${props.token.value}`}
          title="Tap to edit · ↑↓ nudge"
          onClick={() => {
            if (!editing()) open()
          }}
          onKeyDown={(e: KeyboardEvent) => chipKeyDown(e, openIfIdle)}
        >
          <Show when={props.token.type === 'color'}>
            <ColorSwatch token={props.token} />
          </Show>

          <Show when={editing()}>
            <input
              ref={(el) => {
                inputEl = el
                setTimeout(() => {
                  el?.focus()
                  el?.select()
                }, 0)
              }}
              class="kf-chip__input"
              list={dlId}
              type="text"
              value={props.token.value}
              style={{ width: `${Math.max(6, props.token.value.length + 2)}ch` }}
              onInput={onInputChange}
              onKeyDown={onKeyDown}
              onBlur={() => close()}
              autocomplete="on"
              autocorrect="off"
              autocapitalize="none"
              spellcheck={false}
            />
            {/* Screen eyedropper (audit old-F11): was available but unused.
                Shown only where the API exists; cancels silently. */}
            <Show when={props.token.type === 'color' && EYE_DROPPER_SUPPORTED}>
              <button
                class="kf-chip__eyedropper"
                title="Pick a color from the screen"
                aria-label="Pick a color from the screen"
                onClick={(e) => {
                  e.stopPropagation()
                  const path = props.token.path
                  void pickFromScreen().then((hex) => {
                    if (hex) commit(path, hex)
                  })
                }}
              >
                ◉
              </button>
            </Show>
          </Show>

          <Show when={!editing()}>
            <span class="kf-chip__label">{props.token.value}</span>
          </Show>
        </span>
      </Show>
    </>
  )
}

// ── KeyframeRow ────────────────────────────────────────────────────────────────

function KeyframeRow(props: { layerId: string; track: Track; kf: Keyframe }) {
  const [easingOpen, setEasingOpen] = createSignal(false)
  const [editTime, setEditTime] = createSignal(false)
  let timeInputEl: HTMLInputElement | undefined

  // F11: scroll target when this keyframe gets selected from the timeline.
  let rowEl: HTMLDivElement | undefined

  // Per-row token derivation from the store proxy: reactive to this row's
  // fields only, so sibling rows never recompute (or remount) on a commit.
  const valueToken = createMemo(() => tokenizeKeyframe(props.layerId, props.track, props.kf)[0])
  const easingToken = createMemo(() => tokenizeKeyframe(props.layerId, props.track, props.kf)[1])

  // Cross-highlight follow-through (audit F11): when selection ORIGINATES on
  // the timeline canvas, bring the owning row into view — DevTools-style.
  // The origin hint (set by Timeline before setSelectedKeyframeId) keeps us
  // from scroll-jacking clicks that happen inside this very row; only one
  // row ever matches the id, so it is also the only consumer of the hint.
  createEffect(() => {
    if (selectedKeyframeId() !== props.kf.id) return
    if (consumeKeyframeSelectionSource() !== 'canvas') return
    rowEl?.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  })

  function commitTime() {
    const n = Number(timeInputEl?.value)
    // Clamp to the document duration: stops beyond 100% are silently
    // dropped by browsers, so storing them only corrupts exports.
    if (!isNaN(n) && n >= 0) {
      updateKeyframe(props.layerId, props.track.id, props.kf.id, {
        time: Math.min(n, doc.duration),
      })
    }
    setEditTime(false)
  }

  return (
    <div
      ref={rowEl}
      class="kf-row"
      classList={{ 'kf-row--selected': selectedKeyframeId() === props.kf.id }}
      onClick={() => {
        // Reverse direction (audit F11): clicking a row lights up its
        // diamond in the timeline. 'inspector' origin → no auto-scroll,
        // since the user is already looking right at this row.
        setKeyframeSelectionSource('inspector')
        setSelectedKeyframeId(props.kf.id)
      }}
    >
      <div class="kf-row__main">
        <Show when={!editTime()}>
          <span
            class="kf-time"
            tabindex={0}
            role="button"
            aria-label={`Edit keyframe time ${props.kf.time} milliseconds`}
            onClick={() => setEditTime(true)}
            onKeyDown={(e: KeyboardEvent) => chipKeyDown(e, () => setEditTime(true))}
            title="Click to edit time"
          >
            {props.kf.time}
            <span class="kf-time__unit">ms</span>
          </span>
        </Show>
        <Show when={editTime()}>
          <input
            ref={(el) => {
              timeInputEl = el
              setTimeout(() => {
                el?.focus()
                el?.select()
              }, 0)
            }}
            class="kf-time kf-time--input"
            type="number"
            min="0"
            value={props.kf.time}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') commitTime()
              if (e.key === 'Escape') setEditTime(false)
            }}
            onBlur={commitTime}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            spellcheck={false}
          />
        </Show>

        <ValueChip token={valueToken()} property={props.track.property} />

        <span
          class="kf-chip kf-chip--easing"
          classList={{ 'kf-chip--easing-open': easingOpen() }}
          tabindex={0}
          role="button"
          aria-label={`Edit easing curve ${props.kf.easing}`}
          aria-expanded={easingOpen()}
          onClick={() => setEasingOpen((v) => !v)}
          onKeyDown={(e: KeyboardEvent) => chipKeyDown(e, () => setEasingOpen((v) => !v))}
          title="Edit easing curve"
        >
          {props.kf.easing}
        </span>

        <button
          class="kf-row__delete"
          onClick={(e) => {
            // Don't let removal double as a row-click selection — deleting
            // must not re-point selectedKeyframeId at the vanishing keyframe.
            e.stopPropagation()
            removeKeyframe(props.layerId, props.track.id, props.kf.id)
          }}
          title="Remove keyframe"
          aria-label="Remove keyframe"
        >
          ✕
        </button>
      </div>

      <Show when={easingOpen()}>
        <EasingEditor
          value={props.kf.easing}
          onChange={(v) => commit(easingToken().path, v)}
          onClose={() => setEasingOpen(false)}
        />
      </Show>
    </div>
  )
}

// ── TrackSection ──────────────────────────────────────────────────────────────

function TrackSection(props: {
  layerId: string
  track: Track
  property: string
  onAddKeyframe: () => void
}) {
  const [collapsed, setCollapsed] = createSignal(false)
  // Sorted keyframe view derived from the store's stable proxies. <For>
  // diffs by reference: because we hand it the store's own keyframe
  // objects, value commits no longer tear down sibling rows (the row's
  // editing state and mounted editors survive every commit).
  const sortedKfs = () => [...props.track.keyframes].sort((a, b) => a.time - b.time)

  return (
    <div class="track">
      <div class="track__header">
        <button
          class="track__collapse"
          classList={{ 'track__collapse--open': !collapsed() }}
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed() ? 'Expand' : 'Collapse'}
        >
          ▶
        </button>
        <span class="track__prop">{props.property}</span>
        <span class="track__count">{props.track.keyframes.length}</span>
        <button
          class="track__add"
          onClick={() => props.onAddKeyframe()}
          title="Add keyframe at playhead"
        >
          + KF
        </button>
        <button
          class="track__add"
          onClick={() =>
            easeAllTrackKeyframes(props.layerId, props.track, EASY_EASE_EASING, updateKeyframe)
          }
          disabled={props.track.keyframes.length === 0}
          title="Easy ease — set ease-out on every keyframe of this track (F9 works on the selected key's track)"
        >
          Easy ease
        </button>
        <button
          class="track__remove"
          onClick={() => removeTrack(props.layerId, props.track.id)}
          title={`Remove ${props.property} track`}
          aria-label={`Remove ${props.property} track and all its keyframes`}
        >
          ✕
        </button>
      </div>

      <Show when={!collapsed()}>
        <div class="track__keyframes">
          <For
            each={sortedKfs()}
            fallback={<span class="track__empty">No keyframes — tap +&nbsp;KF to add</span>}
          >
            {(kf) => <KeyframeRow layerId={props.layerId} track={props.track} kf={kf} />}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ── Inspector root ────────────────────────────────────────────────────────────

type Tab = 'inspector' | 'css'

export default function Inspector() {
  const [activeTab, setActiveTab] = createSignal<Tab>('inspector')
  const layer = () => getSelectedLayer()

  // ── Batch easing assistant shortcut (plan §3.2, Phase A) ──────────────
  // F9 = AE's Easy Ease muscle memory: ease EVERY keyframe of the track
  // that owns the selected keyframe. Phase-A scope is the track (the store
  // holds a single selectedKeyframeId; multi-select is plan §2.2). Typing
  // surfaces keep native behavior; with no keyframe selected it's a no-op —
  // the per-track "Easy ease" button covers that case explicitly.
  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'F9') return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.isContentEditable ||
          t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT')
      ) {
        return
      }
      const sel = getSelectedTrackAndKeyframe()
      const lId = selectedLayerId()
      if (!sel || !lId) return
      e.preventDefault()
      easeAllTrackKeyframes(lId, sel.track, EASY_EASE_EASING, updateKeyframe)
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })

  function handleAddTrack(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement
    const prop = sel.value as AnimatableProperty
    if (!prop || !selectedLayerId()) return
    addTrack(selectedLayerId()!, prop)
    sel.value = ''
  }

  let CodeViewComponent: Component | undefined
  const [codeViewReady, setCodeViewReady] = createSignal(false)
  function loadCodeView() {
    if (codeViewReady()) return
    void import('./CodeView').then((m) => {
      CodeViewComponent = m.default as Component
      setCodeViewReady(true)
    })
  }
  onCleanup(() => {
    CodeViewComponent = undefined
  })

  return (
    <aside class="panel inspector">
      <div class="inspector__tab-bar">
        <button
          class="inspector__tab"
          classList={{ 'inspector__tab--active': activeTab() === 'inspector' }}
          onClick={() => setActiveTab('inspector')}
        >
          Inspector
        </button>
        <button
          class="inspector__tab"
          classList={{ 'inspector__tab--active': activeTab() === 'css' }}
          onClick={() => {
            setActiveTab('css')
            loadCodeView()
          }}
        >
          CSS
        </button>
      </div>

      <Show when={activeTab() === 'inspector'}>
        <Show when={layer()} fallback={<p class="inspector__empty">Select a layer to inspect</p>}>
          {(l) => (
            <div class="inspector__body">
              <For
                each={l().tracks}
                fallback={<p class="inspector__empty">No tracks — add a property below</p>}
              >
                {(track) => (
                  <TrackSection
                    layerId={l().id}
                    track={track}
                    property={track.property}
                    onAddKeyframe={() => {
                      if (!selectedLayerId()) return
                      addKeyframe(selectedLayerId()!, track.id, {
                        time: playhead(),
                        value: '',
                        easing: 'ease-out',
                      })
                    }}
                  />
                )}
              </For>

              {/* Per-layer transform-origin control (plan §3): numeric axes
                  + preset grid + pick-on-stage trigger. */}
              <OriginSection />

              <div class="inspector__add-track">
                <select class="input" onChange={handleAddTrack}>
                  <option value="">+ Add property track</option>
                  <For each={PROPERTIES}>
                    {(p) => (
                      <option value={p} disabled={l().tracks.some((t) => t.property === p)}>
                        {p}
                        {l().tracks.some((t) => t.property === p) ? ' (tracked)' : ''}
                      </option>
                    )}
                  </For>
                </select>
              </div>
            </div>
          )}
        </Show>
      </Show>

      <Show when={activeTab() === 'css'}>
        <Show
          when={codeViewReady() && CodeViewComponent}
          fallback={<p class="inspector__empty">Loading…</p>}
        >
          {/* @ts-expect-error: dynamic import resolved at runtime */}
          <CodeViewComponent />
        </Show>
      </Show>
    </aside>
  )
}
