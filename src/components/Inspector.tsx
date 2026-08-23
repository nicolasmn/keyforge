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
import { createSignal, createMemo, For, Show, onCleanup, type Component } from 'solid-js'
import { render } from 'solid-js/web'
import {
  selectedLayerId,
  getSelectedLayer,
  addTrack,
  addKeyframe,
  updateKeyframe,
  removeKeyframe,
  playhead,
  doc,
} from '@/store'
import type { AnimatableProperty, EasingName, ValueToken, SubToken } from '@/types'
import EasingEditor from './EasingEditor'
import { tokenizeLayer, NUMBER_UNIT_RE } from '@/utils/tokenize'
import { completionsFor, UNIT_GROUPS, isAngleUnit, toDeg } from '@/utils/cssCompletions'

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
    return value === 'linear' || /^cubic-bezier\(/.test(value) || /^steps\(/.test(value)
  return value.length > 0
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

// ── RotationDial ───────────────────────────────────────────────────────────────

function RotationDial(props: { deg: number }) {
  const R = 7
  const cx = 9,
    cy = 9
  const rad = () => ((props.deg - 90) * Math.PI) / 180
  const nx = () => +(cx + R * Math.cos(rad())).toFixed(2)
  const ny = () => +(cy + R * Math.sin(rad())).toFixed(2)
  return (
    <svg class="kf-rot-dial" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
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

interface NumberUnitFieldProps {
  numStr: string
  unit: string
  onCommit: (num: string, unit: string) => void
  onCancel: () => void
}

function NumberUnitField(props: NumberUnitFieldProps) {
  let wrapperEl: HTMLSpanElement | undefined
  let inputEl: HTMLInputElement | undefined
  // Intentional seed-once: the inline editor snapshots the value at mount;
  // live-tracking props while open would clobber in-progress user input.
  // eslint-disable-next-line solid/reactivity
  const [localUnit, setLocalUnit] = createSignal(props.unit)
  // eslint-disable-next-line solid/reactivity
  const [localNum, setLocalNum] = createSignal(props.numStr)

  const deg = () =>
    isAngleUnit(localUnit()) ? toDeg(parseFloat(localNum()) || 0, localUnit()) : null

  function doCommit() {
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
          {(group) => (
            <optgroup label={group.label}>
              <For each={group.units}>{(u) => <option value={u}>{u === '' ? '—' : u}</option>}</For>
            </optgroup>
          )}
        </For>
      </select>
      <Show when={deg() !== null}>
        <RotationDial deg={deg()!} />
      </Show>
    </span>
  )
}

// ── Color swatch ──────────────────────────────────────────────────────────────

function ColorSwatch(props: { token: ValueToken }) {
  return (
    <span
      class="kf-chip__swatch"
      style={{ background: props.token.value }}
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

function SubScrub(props: { sub: SubToken; parent: ValueToken }) {
  const [editing, setEditing] = createSignal(false)

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
          onClick={() => setEditing(true)}
          title="Tap to edit"
        >
          {props.sub.value}
          {props.sub.unit}
        </span>
      }
    >
      <NumberUnitField
        numStr={props.sub.value}
        unit={props.sub.unit || 'px'}
        onCommit={commitSub}
        onCancel={() => setEditing(false)}
      />
    </Show>
  )
}

// ── ValueChip ─────────────────────────────────────────────────────────────────

function ValueChip(props: { token: ValueToken }) {
  const [editing, setEditing] = createSignal(false)
  const [invalid, setInvalid] = createSignal(false)
  let inputEl: HTMLInputElement | undefined
  let cleanupDl: (() => void) | null = null
  onCleanup(() => {
    cleanupDl?.()
  })

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

  function open() {
    if (props.token.type === 'transform') return
    if (!cleanupDl) {
      cleanupDl = mountDatalist(dlId, completionsFor(props.token.type, props.token.value))
    }
    setInvalid(false)
    setEditing(true)
  }

  function close(revert = false) {
    if (!revert) {
      const raw = inputEl?.value ?? props.token.value
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
      {/* transform: sub-token chips, grouped per function */}
      <Show when={props.token.type === 'transform' && (props.token.subTokens?.length ?? 0) > 0}>
        <span class="kf-chip kf-chip--transform">
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
                      <SubScrub sub={sub} parent={props.token} />
                      <Show when={i() < g.subs.length - 1}>
                        <span class="kf-chip__sep">, </span>
                      </Show>
                    </>
                  )}
                </For>
                <span class="kf-chip__fn">)</span>
              </>
            )}
          </For>
        </span>
      </Show>

      {/* number: NumberUnitField when editing, labeled chip at rest */}
      <Show when={props.token.type === 'number'}>
        <Show
          when={editing()}
          fallback={
            <span
              class="kf-chip kf-chip--number"
              classList={{ 'kf-chip--error': invalid() }}
              onClick={() => open()}
              title="Tap to edit"
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
          title="Tap to edit"
          onClick={() => {
            if (!editing()) open()
          }}
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

function KeyframeRow(props: {
  layerId: string
  trackId: string
  kfId: string
  time: number
  valueToken: ValueToken
  easingToken: ValueToken
}) {
  const [easingOpen, setEasingOpen] = createSignal(false)
  const [editTime, setEditTime] = createSignal(false)
  let timeInputEl: HTMLInputElement | undefined

  function commitTime() {
    const n = Number(timeInputEl?.value)
    if (!isNaN(n) && n >= 0) updateKeyframe(props.layerId, props.trackId, props.kfId, { time: n })
    setEditTime(false)
  }

  return (
    <div class="kf-row">
      <div class="kf-row__main">
        <Show when={!editTime()}>
          <span class="kf-time" onClick={() => setEditTime(true)} title="Click to edit time">
            {props.time}
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
            value={props.time}
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

        <ValueChip token={props.valueToken} />

        <span
          class="kf-chip kf-chip--easing"
          classList={{ 'kf-chip--easing-open': easingOpen() }}
          onClick={() => setEasingOpen((v) => !v)}
          title="Edit easing curve"
        >
          {props.easingToken.value}
        </span>

        <button
          class="kf-row__delete"
          onClick={() => removeKeyframe(props.layerId, props.trackId, props.kfId)}
          title="Remove keyframe"
          aria-label="Remove keyframe"
        >
          ✕
        </button>
      </div>

      <Show when={easingOpen()}>
        <EasingEditor
          value={props.easingToken.value}
          onChange={(v) => commit(props.easingToken.path, v)}
          onClose={() => setEasingOpen(false)}
        />
      </Show>
    </div>
  )
}

// ── TrackSection ──────────────────────────────────────────────────────────────

function TrackSection(props: {
  layerId: string
  trackId: string
  property: string
  kfTokenPairs: Array<{ time: number; kfId: string; value: ValueToken; easing: ValueToken }>
  onAddKeyframe: () => void
}) {
  const [collapsed, setCollapsed] = createSignal(false)

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
        <span class="track__count">{props.kfTokenPairs.length}</span>
        <button
          class="track__add"
          onClick={() => props.onAddKeyframe()}
          title="Add keyframe at playhead"
        >
          + KF
        </button>
      </div>

      <Show when={!collapsed()}>
        <div class="track__keyframes">
          <For
            each={props.kfTokenPairs}
            fallback={<span class="track__empty">No keyframes — tap +&nbsp;KF to add</span>}
          >
            {(pair) => (
              <KeyframeRow
                layerId={props.layerId}
                trackId={props.trackId}
                kfId={pair.kfId}
                time={pair.time}
                valueToken={pair.value}
                easingToken={pair.easing}
              />
            )}
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

  const tokenMap = createMemo(() => {
    const l = layer()
    if (!l) return new Map<string, ValueToken>()
    const tokens = tokenizeLayer(l, doc)
    const map = new Map<string, ValueToken>()
    for (const t of tokens) {
      map.set(`${t.path.trackId}:${t.path.keyframeId}:${t.path.field}`, t)
    }
    return map
  })

  function getToken(trackId: string, kfId: string, field: 'value' | 'easing') {
    return tokenMap().get(`${trackId}:${kfId}:${field}`)
  }

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
                {(track) => {
                  const pairs = () =>
                    track.keyframes
                      .slice()
                      .sort((a, b) => a.time - b.time)
                      .flatMap((kf) => {
                        const vt = getToken(track.id, kf.id, 'value')
                        const et = getToken(track.id, kf.id, 'easing')
                        if (!vt || !et) return []
                        return [{ time: kf.time, kfId: kf.id, value: vt, easing: et }]
                      })

                  return (
                    <TrackSection
                      layerId={l().id}
                      trackId={track.id}
                      property={track.property}
                      kfTokenPairs={pairs()}
                      onAddKeyframe={() => {
                        if (!selectedLayerId()) return
                        addKeyframe(selectedLayerId()!, track.id, {
                          time: playhead(),
                          value: '',
                          easing: 'ease-out',
                        })
                      }}
                    />
                  )
                }}
              </For>

              <div class="inspector__add-track">
                <select class="input" onChange={handleAddTrack}>
                  <option value="">+ Add property track</option>
                  <For each={PROPERTIES}>{(p) => <option value={p}>{p}</option>}</For>
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
