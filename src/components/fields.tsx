/**
 * Shared inspector form controls, extracted from Inspector.tsx so sibling
 * panels (transform-origin section) can reuse them without circular imports.
 *
 * RotationDial — LIVE drag model: every pointer move schedules a store write
 * via `onLive`, coalesced to at most ONE call per animation frame; the local
 * dragDeg preview still drives the needle so feedback is instant between
 * frames. Alt/Shift quantize DURING the drag (1° default · Alt 0.1° fine ·
 * Shift 10° coarse — unified app-wide ladder), anchored at the pre-drag
 * angle. Pointerup/lostpointercapture commits the final exact value via
 * `onCommit`; Escape restores the pre-drag value with one write (cancel).
 * Keyboard nudges commit immediately (arrows ±1°, Alt ±0.1°, Shift ±10°).
 *
 * NumberUnitField — uncontrolled number+unit pair: value seeded once at
 * mount, committed on blur/Enter/unit-change, reverted on Escape. The unit
 * dropdown filters through PROPERTY_REGISTRY unless `allowedUnitsOverride`
 * supplies an explicit whitelist.
 */
import { createSignal, For, Show } from 'solid-js'
import type { AnimatableProperty } from '@/types'
import { degFromPoint } from '@/utils/dialGeometry'
import { unwrapAround, quantizeAngle } from '@/utils/rotationMath'
import { stepWithModifiers, type ScrubModifiers } from '@/utils/scrub'
import { PROPERTY_REGISTRY } from '@/utils/propertyRegistry'
import { UNIT_GROUPS, isAngleUnit, toDeg } from '@/utils/cssCompletions'

// ── RotationDial ───────────────────────────────────────────────────────────────

export function RotationDial(props: {
  deg: number
  /** Final exact commit — gesture end / keyboard nudge. */
  onCommit?: (deg: number) => void
  /** Live drag feedback — rAF-coalesced to ≤1 call per animation frame. */
  onLive?: (deg: number) => void
}) {
  const R = 7
  const cx = 9,
    cy = 9
  const [dragDeg, setDragDeg] = createSignal<number | undefined>(undefined)
  // Mid-drag the local preview wins; at rest we render the authored value.
  const shownDeg = () => dragDeg() ?? props.deg
  const rad = () => ((shownDeg() - 90) * Math.PI) / 180
  const nx = () => +(cx + R * Math.cos(rad())).toFixed(2)
  const ny = () => +(cy + R * Math.sin(rad())).toFixed(2)
  const interactive = () => typeof props.onCommit === 'function'
  let svgEl: SVGSVGElement | undefined

  // Plain flags, not signals: they mutate at pointer-event frequency and are
  // read only inside handlers/rAF, never by reactive JSX.
  let dragging = false
  let origDeg = 0 // pre-drag snapshot — Escape restores it, quantization anchors here
  let lastRaw = 0 // last continuous pointer angle
  let lastMods: ScrubModifiers = {}
  let raf = 0 // pending onLive frame (0 = none scheduled)
  let wrote = false // any live store write this gesture? (gates Escape restore)

  /** Pointer position → continuous dial degrees around the pre-drag origin. */
  function rawDegFromEvent(e: PointerEvent): number {
    const rect = svgEl!.getBoundingClientRect()
    const wrapped = degFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      e.clientX,
      e.clientY,
      shownDeg(),
    )
    return unwrapAround(origDeg, wrapped)
  }

  function onDragKey(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelDrag()
  }

  function startDrag(e: PointerEvent) {
    if (!interactive()) return
    e.stopPropagation() // keep the owning chip from opening its editor
    e.preventDefault()
    dragging = true
    wrote = false
    origDeg = props.deg
    lastRaw = rawDegFromEvent(e)
    lastMods = { shift: e.shiftKey, alt: e.altKey }
    window.addEventListener('keydown', onDragKey) // Escape mid-drag cancels
    try {
      svgEl!.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events may not support capture */
    }
    setDragDeg(quantizeAngle(origDeg, lastRaw, lastMods)) // needle preview
  }

  function flushLive() {
    raf = 0
    if (!dragging) return
    props.onLive?.(quantizeAngle(origDeg, lastRaw, lastMods))
    wrote = true
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    e.preventDefault()
    lastRaw = rawDegFromEvent(e)
    lastMods = { shift: e.shiftKey, alt: e.altKey }
    setDragDeg(quantizeAngle(origDeg, lastRaw, lastMods)) // instant needle
    if (!raf) raf = requestAnimationFrame(flushLive) // ≤1 store write / frame
  }

  function cancelDrag() {
    if (!dragging) return
    endDrag(false)
  }

  /** End of gesture. Live writes already happened per-frame; commit=true
   *  lands one final exact value so throttling never loses the drag tail.
   *  commit=false (Escape) restores the pre-drag value when we wrote. */
  function endDrag(commit: boolean) {
    if (!dragging) return
    dragging = false
    window.removeEventListener('keydown', onDragKey)
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const final = quantizeAngle(origDeg, lastRaw, lastMods)
    setDragDeg(undefined) // discard preview → needle renders committed value
    if (!commit) {
      if (wrote && typeof props.onCommit === 'function') props.onCommit(origDeg)
      return
    }
    props.onCommit!(final)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!interactive()) return
    const mods: ScrubModifiers = { shift: e.shiftKey, alt: e.altKey }
    const step = stepWithModifiers(1, mods)
    let next: number | null = null
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = shownDeg() + step
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = shownDeg() - step
    else return
    e.preventDefault()
    e.stopPropagation()
    props.onCommit!(((next % 360) + 360) % 360)
  }

  return (
    <svg
      ref={(el) => {
        svgEl = el
      }}
      class="kf-rot-dial"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden={!interactive()}
      role={interactive() ? 'slider' : undefined}
      tabindex={interactive() ? 0 : undefined}
      aria-label={interactive() ? 'Rotation' : undefined}
      aria-valuemin={interactive() ? 0 : undefined}
      aria-valuemax={interactive() ? 359 : undefined}
      aria-valuenow={interactive() ? Math.round(((shownDeg() % 360) + 360) % 360) : undefined}
      aria-valuetext={interactive() ? `${Math.round(shownDeg() * 10) / 10} degrees` : undefined}
      classList={{ 'kf-rot-dial--live': interactive() }}
      onPointerDown={startDrag}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(true)}
      onLostPointerCapture={() => endDrag(true)}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (interactive()) e.stopPropagation()
      }}
    >
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke="currentColor"
        stroke-opacity="0.25"
        stroke-width="1.5"
      />
      <line
        x1={cx}
        y1={cy}
        x2={nx()}
        y2={ny()}
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <circle cx={cx} cy={cy} r="1.5" fill="currentColor" />
    </svg>
  )
}

// ── NumberUnitField ────────────────────────────────────────────────────────────
//
// Blur-bug fix: we listen to focusout on the *wrapper span* rather than
// blur on the input. focusout bubbles; we check relatedTarget to see if
// the new focus target is still inside the wrapper. If yes → stay open.
// Only commit when focus leaves the entire component.

export interface NumberUnitFieldProps {
  numStr: string
  unit: string
  /** Property context for unit filtering/validation (optional — transform
   *  sub-tokens pass their owning track's property). */
  property?: AnimatableProperty
  /** Explicit unit whitelist overriding the registry lookup — used by the
   *  transform-origin X/Y fields (% px em rem vw vh). */
  allowedUnitsOverride?: readonly string[]
  onCommit: (num: string, unit: string) => void
  onCancel: () => void
}

export function NumberUnitField(props: NumberUnitFieldProps) {
  let wrapperEl: HTMLSpanElement | undefined
  let inputEl: HTMLInputElement | undefined
  // Intentional seed-once: the inline editor snapshots the value at mount;
  // live-tracking props while open would clobber in-progress user input.
  // eslint-disable-next-line solid/reactivity
  const [localUnit, setLocalUnit] = createSignal(props.unit)
  // eslint-disable-next-line solid/reactivity
  const [localNum, setLocalNum] = createSignal(props.numStr)

  // Registry-driven unit filtering: when the property is known, the unit
  // dropdown only offers units that make sense for it (no `opacity: 0vw`).
  const allowedUnits = () =>
    props.allowedUnitsOverride ??
    (props.property ? (PROPERTY_REGISTRY[props.property]?.units ?? null) : null)

  function commitIsValid(): boolean {
    const num = parseFloat(localNum())
    if (Number.isNaN(num)) return false
    const allowed = allowedUnits()
    if (!allowed) return true // no property context → legacy behavior
    return allowed.includes(localUnit())
  }

  const deg = () =>
    isAngleUnit(localUnit()) ? toDeg(parseFloat(localNum()) || 0, localUnit()) : null

  function doCommit() {
    if (!commitIsValid()) {
      props.onCancel() // revert — invalid number/unit for this property
      return
    }
    props.onCommit(inputEl?.value ?? localNum(), localUnit())
  }

  function onWrapperFocusOut(e: FocusEvent) {
    // If the new focus target is still inside the wrapper, ignore
    if (wrapperEl && e.relatedTarget instanceof Node && wrapperEl.contains(e.relatedTarget)) return
    doCommit()
  }

  return (
    <span
      ref={(el) => {
        wrapperEl = el
      }}
      class="kf-num-field"
      onFocusOut={onWrapperFocusOut}
    >
      <input
        ref={(el) => {
          inputEl = el
          setTimeout(() => {
            el?.focus()
            el?.select()
          }, 0)
        }}
        class="kf-num-field__num"
        type="number"
        value={props.numStr}
        onInput={(e) => setLocalNum((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            doCommit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            props.onCancel()
          }
          if (e.key === 'Tab') {
            /* let tab move to unit select naturally */
          }
        }}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="none"
        spellcheck={false}
      />
      <select
        class="kf-num-field__unit"
        value={localUnit()}
        onChange={(e) => {
          const u = (e.currentTarget as HTMLSelectElement).value
          setLocalUnit(u)
          // commit immediately when unit changes, keep editing open
          props.onCommit(inputEl?.value ?? localNum(), u)
          // re-focus input after unit change
          setTimeout(() => inputEl?.focus(), 0)
        }}
      >
        <For each={UNIT_GROUPS}>
          {(group) => {
            const allowed = allowedUnits()
            const units = allowed ? group.units.filter((u) => allowed.includes(u)) : group.units
            if (units.length === 0) return null
            return (
              <optgroup label={group.label}>
                <For each={units}>{(u) => <option value={u}>{u === '' ? '—' : u}</option>}</For>
              </optgroup>
            )
          }}
        </For>
      </select>
      <Show when={deg() !== null}>
        <RotationDial deg={deg()!} />
      </Show>
    </span>
  )
}
