/**
 * Inspector — DevTools-style panel.
 *
 * Design decisions:
 * - UNCONTROLLED inputs: set value once on open, commit on blur/Enter/Tab/Escape.
 * - No drag-scrub anywhere (removed). Numbers use type="number" spinner/keyboard.
 * - Transform args are editable via tap → inline number input per sub-token.
 * - <datalist> rendered in a portal div appended to document.body so it is
 *   never clipped by overflow:hidden parents. This is the only reliable way
 *   to show the dropdown on all browsers including iOS Safari.
 * - autocomplete="on" + list= is required for datalist on iOS. "off" breaks it.
 * - autocorrect="off" autocapitalize="none" prevents iOS mangling CSS values.
 */
import {
  createSignal, createMemo, For, Show, onCleanup,
  type Component,
} from 'solid-js'
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
import { completionsFor } from '@/utils/cssCompletions'

const PROPERTIES: AnimatableProperty[] = [
  'opacity', 'transform', 'background-color', 'color',
  'border-radius', 'width', 'height', 'scale', 'translate', 'rotate',
]

// ── helpers ──────────────────────────────────────────────────────────────────

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
  if (type === 'color')  return CSS.supports('color', value)
  if (type === 'number') return NUMBER_UNIT_RE.test(value) || value === '' || !isNaN(Number(value))
  if (type === 'easing') return value === 'linear' || /^cubic-bezier\(/.test(value) || /^steps\(/.test(value)
  return value.length > 0
}

/**
 * Mount a <datalist> into document.body (portal) so it is never clipped
 * by overflow:hidden ancestors. Returns a cleanup function.
 */
function mountDatalist(id: string, options: string[]): () => void {
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  document.body.appendChild(host)
  const dispose = render(() => (
    <datalist id={id}>
      <For each={options}>{(o) => <option value={o} />}</For>
    </datalist>
  ), host)
  return () => { dispose(); document.body.removeChild(host) }
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
        inp.oninput  = () => commit(props.token.path, inp.value)
        inp.onchange = () => commit(props.token.path, inp.value)
        inp.click()
      }}
    />
  )
}

// ── SubScrub: editable sub-token chip (transform arg) ────────────────────────
// Tap to open an inline number input. No drag.

function SubScrub(props: { sub: SubToken; parent: ValueToken }) {
  const [editing, setEditing] = createSignal(false)
  let inputEl: HTMLInputElement | undefined

  function commitSub() {
    const raw = inputEl?.value ?? ''
    const n = parseFloat(raw)
    if (!isNaN(n)) {
      const updated = props.parent.subTokens!.map((st) =>
        st.argIndex === props.sub.argIndex
          ? { ...st, value: String(n) }
          : st
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
          {props.sub.value}{props.sub.unit}
        </span>
      }
    >
      <input
        ref={(el) => {
          inputEl = el
          setTimeout(() => { el?.focus(); el?.select() }, 0)
        }}
        class="kf-chip kf-chip--number kf-chip--sub kf-chip--editing kf-chip__input"
        type="number"
        value={props.sub.value}
        style={{ width: `${Math.max(4, props.sub.value.length + 2)}ch` }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitSub() }
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={commitSub}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="none"
        spellcheck={false}
      />
    </Show>
  )
}

// ── ValueChip ─────────────────────────────────────────────────────────────────
// UNCONTROLLED. No drag. Tap to open, blur/Enter/Escape to close.

function ValueChip(props: { token: ValueToken }) {
  const [editing, setEditing] = createSignal(false)
  const [invalid,  setInvalid]  = createSignal(false)
  let inputEl: HTMLInputElement | undefined
  let cleanupDl: (() => void) | null = null

  // Mount datalist portal lazily on first open, clean up on chip unmount
  onCleanup(() => { cleanupDl?.() })

  const dlId = `kf-dl-${Math.random().toString(36).slice(2)}`

  function open() {
    if (props.token.type === 'transform') return
    // Mount datalist portal once
    if (!cleanupDl) {
      cleanupDl = mountDatalist(dlId, completionsFor(props.token.type, props.token.value))
    }
    setInvalid(false)
    setEditing(true)
  }

  function close(revert = false) {
    const raw = inputEl?.value ?? props.token.value
    if (!revert) {
      if (validate(props.token.type, raw)) {
        // For numbers, preserve unit from original value if user typed bare number
        if (props.token.type === 'number' && !NUMBER_UNIT_RE.test(raw)) {
          const m = NUMBER_UNIT_RE.exec(props.token.value)
          const unit = m?.[2] ?? ''
          commit(props.token.path, `${raw}${unit}`)
        } else {
          commit(props.token.path, raw)
        }
        setInvalid(false)
      } else {
        setInvalid(true)
        commit(props.token.path, props.token.value)
      }
    }
    setEditing(false)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); close() }
    if (e.key === 'Escape') { e.preventDefault(); close(true) }
    if (e.key === 'Tab')   { close() }
  }

  function onInputChange(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value
    setInvalid(!validate(props.token.type, v))
  }

  const isNumber = () => props.token.type === 'number'

  return (
    <>
      {/* transform: render sub-token chips inline */}
      <Show when={props.token.type === 'transform' && (props.token.subTokens?.length ?? 0) > 0}>
        <span class="kf-chip kf-chip--transform">
          <span class="kf-chip__fn">{props.token.value.split('(')[0]}(</span>
          <For each={props.token.subTokens}>
            {(sub, i) => (
              <>
                <SubScrub sub={sub} parent={props.token} />
                <Show when={i() < (props.token.subTokens!.length - 1)}>
                  <span class="kf-chip__sep">, </span>
                </Show>
              </>
            )}
          </For>
          <span class="kf-chip__fn">)</span>
        </span>
      </Show>

      {/* all other types */}
      <Show when={props.token.type !== 'transform'}>
        <span
          class="kf-chip"
          classList={{
            [`kf-chip--${props.token.type}`]: true,
            'kf-chip--editing': editing(),
            'kf-chip--error':   editing() && invalid(),
          }}
          title="Tap to edit"
          onClick={() => { if (!editing()) open() }}
        >
          <Show when={props.token.type === 'color'}>
            <ColorSwatch token={props.token} />
          </Show>

          <Show when={editing()}>
            <input
              ref={(el) => {
                inputEl = el
                setTimeout(() => { el?.focus(); el?.select() }, 0)
              }}
              class="kf-chip__input"
              // datalist portal is mounted in body; reference it by id
              list={dlId}
              // type=number for number tokens: native spinner + numeric keyboard on mobile
              type={isNumber() ? 'number' : 'text'}
              // For numbers, pass just the numeric part so the number input is happy
              value={isNumber()
                ? (NUMBER_UNIT_RE.exec(props.token.value)?.[1] ?? props.token.value)
                : props.token.value
              }
              style={{ width: `${Math.max(6, props.token.value.length + 2)}ch` }}
              onInput={onInputChange}
              onKeyDown={onKeyDown}
              onBlur={() => close()}
              // autocomplete="on" + list= is the correct combo for datalist on iOS Safari
              // "off" suppresses the dropdown entirely on iOS
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
  const [editTime,   setEditTime]   = createSignal(false)
  let timeInputEl: HTMLInputElement | undefined

  function commitTime() {
    const n = Number(timeInputEl?.value)
    if (!isNaN(n) && n >= 0)
      updateKeyframe(props.layerId, props.trackId, props.kfId, { time: n })
    setEditTime(false)
  }

  return (
    <div class="kf-row">
      <div class="kf-row__main">

        <Show when={!editTime()}>
          <span
            class="kf-time"
            onClick={() => setEditTime(true)}
            title="Click to edit time"
          >
            {props.time}<span class="kf-time__unit">ms</span>
          </span>
        </Show>
        <Show when={editTime()}>
          <input
            ref={(el) => {
              timeInputEl = el
              setTimeout(() => { el?.focus(); el?.select() }, 0)
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
          <For each={props.kfTokenPairs} fallback={
            <span class="track__empty">No keyframes — tap +&nbsp;KF to add</span>
          }>
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
  onCleanup(() => { CodeViewComponent = undefined })

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
          onClick={() => { setActiveTab('css'); loadCodeView() }}
        >
          CSS
        </button>
      </div>

      <Show when={activeTab() === 'inspector'}>
        <Show when={layer()} fallback={<p class="inspector__empty">Select a layer to inspect</p>}>
          {(l) => (
            <div class="inspector__body">
              <For each={l().tracks} fallback={
                <p class="inspector__empty">No tracks — add a property below</p>
              }>
                {(track) => {
                  const pairs = () => track.keyframes
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
        <Show when={codeViewReady() && CodeViewComponent}
          fallback={<p class="inspector__empty">Loading…</p>}
        >
          {/* @ts-expect-error: dynamic import resolved at runtime */}
          <CodeViewComponent />
        </Show>
      </Show>
    </aside>
  )
}
