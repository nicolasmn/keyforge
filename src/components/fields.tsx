/**
 * Shared inspector form controls, extracted from Inspector.tsx so sibling
 * panels (transform-origin section) can reuse them without circular imports.
 *
 * RotationDial — commit-on-release drag model (#68): dragging updates a LOCAL
 * dragDeg preview signal only; exactly ONE commit happens per gesture, on
 * pointerup/lostpointercapture; Escape cancels; Shift+drag snaps to 15°;
 * keyboard nudges commit immediately (arrows ±1°, Shift+arrows ±15°).
 *
 * NumberUnitField — uncontrolled number+unit pair: value seeded once at
 * mount, committed on blur/Enter/unit-change, reverted on Escape. The unit
 * dropdown filters through PROPERTY_REGISTRY unless `allowedUnitsOverride`
 * supplies an explicit whitelist.
 */
import { createSignal, For, Show } from 'solid-js'
import type { AnimatableProperty } from '@/types'
import { degFromPoint, wrapDeg } from '@/utils/dialGeometry'
import { PROPERTY_REGISTRY } from '@/utils/propertyRegistry'
import { UNIT_GROUPS, isAngleUnit, toDeg, snapToMultiple } from '@/utils/cssCompletions'

// ── RotationDial ───────────────────────────────────────────────────────────────

export function RotationDial(props: { deg: number; onCommit?: (deg: number) => void }) {
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
  let dragging = false

  /** Pointer position → dial degrees (0° points up, clockwise positive). */
  function degFromEvent(e: PointerEvent): number {
    const rect = svgEl!.getBoundingClientRect()
    return degFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      e.clientX,
      e.clientY,
      shownDeg(),
    )
  }

  function onDragKey(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelDrag()
  }

  function startDrag(e: PointerEvent) {
    if (!interactive()) return
    e.stopPropagation() // keep the owning chip from opening its editor
    e.preventDefault()
    dragging = true
    window.addEventListener('keydown', onDragKey) // Escape mid-drag cancels
    try {
      svgEl!.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events may not support capture */
    }
    setDragDeg(degFromEvent(e)) // preview only — no store write yet
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    e.preventDefault()
    const raw = degFromEvent(e)
    setDragDeg(e.shiftKey ? snapToMultiple(raw, 15) : raw)
  }

  function cancelDrag() {
    if (!dragging) return
    dragging = false
    window.removeEventListener('keydown', onDragKey)
    setDragDeg(undefined) // discard preview → needle restores props.deg
  }

  /** End of gesture. Commits the final previewed angle exactly once. */
  function endDrag(commit: boolean) {
    if (!dragging) return
    dragging = false
    window.removeEventListener('keydown', onDragKey)
    const final = dragDeg()
    setDragDeg(undefined)
    if (commit && final !== undefined) props.onCommit!(final)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!interactive()) return
    const step = e.shiftKey ? 15 : 1
    let next: number | null = null
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = shownDeg() + step
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = shownDeg() - step
    else return
    e.preventDefault()
    e.stopPropagation()
    props.onCommit!(wrapDeg(Math.round(next)))
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
      aria-valuetext={interactive() ? `${Math.round(shownDeg())} degrees` : undefined}
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
