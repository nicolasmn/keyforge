/**
 * Inspector — unified DevTools-style panel.
 *
 * Layout per track:
 *   ▶  background-color                          + KF
 *      ├ 0ms   ██ #ff0000   ease-out  ✕
 *      └ 400ms ██ #0000ff   ease-in   ✕
 *
 * Clicking a keyframe row expands it in-place:
 *   ├ 0ms  [time input]  [value token]  [easing chip → opens EasingEditor below]  ✕
 *         ┌─ EasingEditor ──────────────────────────────────────────┐
 *         └─────────────────────────────────────────────────────────┘
 *
 * No separate Tokens tab — token editing IS the property editor.
 */
import { createSignal, createMemo, For, Show } from 'solid-js'
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
import CodeView from './CodeView'
import EasingEditor from './EasingEditor'
import { tokenizeLayer } from '@/utils/tokenize'
import { NUMBER_UNIT_RE } from '@/utils/tokenize'

// ── constants ──────────────────────────────────────────────────────────────

const PROPERTIES: AnimatableProperty[] = [
  'opacity', 'transform', 'background-color', 'color',
  'border-radius', 'width', 'height', 'scale', 'translate', 'rotate',
]

// ── helpers ────────────────────────────────────────────────────────────────

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
  if (type === 'number') return NUMBER_UNIT_RE.test(value)
  if (type === 'easing') return value === 'linear' || /^cubic-bezier\(/.test(value)
  return value.length > 0
}

// ── Sub-token scrub chip (transform args) ──────────────────────────────────

function SubScrub(props: { sub: SubToken; parent: ValueToken }) {
  let origin: { x: number; orig: number } | null = null
  const val  = () => props.sub.value
  const unit = () => props.sub.unit

  function rebuild(newVal: number) {
    const updated = props.parent.subTokens!.map((st) =>
      st.argIndex === props.sub.argIndex
        ? { ...st, value: String(+newVal.toFixed(3)) }
        : st
    ) as SubToken[]
    commit(props.parent.path, props.sub.assembler(updated))
  }

  return (
    <span
      class="kf-chip kf-chip--number kf-chip--scrub"
      title={`Drag · Shift×10 · Alt÷10`}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        origin = { x: e.clientX, orig: parseFloat(val()) }
      }}
      onPointerMove={(e) => {
        if (!origin) return
        const m = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
        rebuild(origin.orig + (e.clientX - origin.x) * m)
      }}
      onPointerUp={() => { origin = null }}
    >
      {val()}{unit()}
    </span>
  )
}

// ── Inline value chip ───────────────────────────────────────────────────────
// Renders a single value token inline — click to edit, drag to scrub numbers.

function ValueChip(props: { token: ValueToken }) {
  const [editing,   setEditing]   = createSignal(false)
  const [editVal,   setEditVal]   = createSignal(props.token.value)
  const [invalid,   setInvalid]   = createSignal(false)
  let scrubOrigin: { x: number; orig: number } | null = null

  function save(v: string) {
    if (validate(props.token.type, v)) commit(props.token.path, v)
  }
  function open() {
    if (props.token.type === 'transform') return
    setEditVal(props.token.value)
    setInvalid(false)
    setEditing(true)
  }
  function close(revert = false) {
    if (!revert && !invalid()) save(editVal())
    else commit(props.token.path, props.token.value)
    setEditing(false)
  }

  // color swatch — opens native color picker
  function Swatch() {
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

  return (
    <>
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

      <Show when={props.token.type !== 'transform'}>
        <span
          class="kf-chip"
          classList={{
            [`kf-chip--${props.token.type}`]: true,
            'kf-chip--editing': editing(),
            'kf-chip--error':   editing() && invalid(),
          }}
          title={props.token.type === 'number' ? 'Drag · Shift×10 · Alt÷10' : undefined}
          onClick={() => { if (!editing()) open() }}
          onPointerDown={(e) => {
            if (props.token.type !== 'number' || editing()) return
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            const m = NUMBER_UNIT_RE.exec(props.token.value)
            scrubOrigin = { x: e.clientX, orig: m ? parseFloat(m[1]) : 0 }
          }}
          onPointerMove={(e) => {
            if (!scrubOrigin) return
            const mult  = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
            const delta = (e.clientX - scrubOrigin.x) * mult
            const m     = NUMBER_UNIT_RE.exec(props.token.value)
            const unit  = m ? (m[2] ?? '') : ''
            commit(props.token.path, `${+(scrubOrigin.orig + delta).toFixed(3)}${unit}`)
          }}
          onPointerUp={() => { scrubOrigin = null }}
        >
          <Show when={props.token.type === 'color'}>
            <Swatch />
          </Show>
          <Show when={editing()}>
            <input
              class="kf-chip__input"
              value={editVal()}
              style={{ width: `${Math.max(4, editVal().length)}ch` }}
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value
                setEditVal(v)
                setInvalid(!validate(props.token.type, v))
                if (!invalid()) save(v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); close() }
                if (e.key === 'Escape') close(true)
              }}
              onBlur={() => close()}
              ref={(el) => setTimeout(() => el?.focus(), 0)}
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

// ── Keyframe row ────────────────────────────────────────────────────────────
// One row per keyframe: time pill | value chip | easing chip | delete

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
  const [timeVal,    setTimeVal]    = createSignal(String(props.time))

  function commitTime(raw: string) {
    const n = Number(raw)
    if (!isNaN(n) && n >= 0)
      updateKeyframe(props.layerId, props.trackId, props.kfId, { time: n })
    setEditTime(false)
  }

  return (
    <div class="kf-row">
      <div class="kf-row__main">
        {/* time pill */}
        <Show when={!editTime()}>
          <span
            class="kf-time"
            onClick={() => { setTimeVal(String(props.time)); setEditTime(true) }}
            title="Click to edit time"
          >
            {props.time}<span class="kf-time__unit">ms</span>
          </span>
        </Show>
        <Show when={editTime()}>
          <input
            class="kf-time kf-time--input input"
            value={timeVal()}
            style={{ width: `${Math.max(3, timeVal().length + 2)}ch` }}
            onInput={(e) => setTimeVal((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTime(timeVal())
              if (e.key === 'Escape') setEditTime(false)
            }}
            onBlur={() => commitTime(timeVal())}
            ref={(el) => setTimeout(() => el?.focus(), 0)}
          />
        </Show>

        {/* value chip */}
        <ValueChip token={props.valueToken} />

        {/* easing chip — pill that opens editor */}
        <span
          class="kf-chip kf-chip--easing"
          classList={{ 'kf-chip--easing-open': easingOpen() }}
          onClick={() => setEasingOpen((v) => !v)}
          title="Edit easing"
        >
          {props.easingToken.value}
        </span>

        {/* delete */}
        <button
          class="kf-row__delete"
          onClick={() => removeKeyframe(props.layerId, props.trackId, props.kfId)}
          title="Remove keyframe"
          aria-label="Remove keyframe"
        >
          ✕
        </button>
      </div>

      {/* inline easing editor */}
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

// ── Track section ────────────────────────────────────────────────────────────

function TrackSection(props: {
  layerId: string
  trackId: string
  property: string
  kfTokenPairs: Array<{ time: number; kfId: string; value: ValueToken; easing: ValueToken }>
  onAddKeyframe: () => void
  onRemoveTrack: () => void
}) {
  const [collapsed, setCollapsed] = createSignal(false)

  return (
    <div class="track">
      {/* track header */}
      <div class="track__header">
        <button
          class="track__collapse"
          classList={{ 'track__collapse--open': !collapsed() }}
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed() ? 'Expand track' : 'Collapse track'}
        >
          ▶
        </button>
        <span class="track__prop">{props.property}</span>
        <span class="track__count">{props.kfTokenPairs.length}</span>
        <button class="track__add" onClick={props.onAddKeyframe} title="Add keyframe at playhead">
          + KF
        </button>
        <button class="track__remove" onClick={props.onRemoveTrack} title="Remove track" aria-label="Remove track">
          ✕
        </button>
      </div>

      {/* keyframe rows */}
      <Show when={!collapsed()}>
        <div class="track__keyframes">
          <For each={props.kfTokenPairs} fallback={
            <span class="track__empty">No keyframes — click + KF to add one at playhead</span>
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

// ── Inspector root ──────────────────────────────────────────────────────────

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
      const key = `${t.path.trackId}:${t.path.keyframeId}:${t.path.field}`
      map.set(key, t)
    }
    return map
  })

  function getToken(trackId: string, kfId: string, field: 'value' | 'easing'): ValueToken | undefined {
    return tokenMap().get(`${trackId}:${kfId}:${field}`)
  }

  function handleAddTrack(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement
    const prop = sel.value as AnimatableProperty
    if (!prop || !selectedLayerId()) return
    addTrack(selectedLayerId()!, prop)
    sel.value = ''
  }

  return (
    <aside class="panel inspector">
      {/* tab bar */}
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
          onClick={() => setActiveTab('css')}
        >
          CSS
        </button>
      </div>

      {/* Inspector tab */}
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
                      onRemoveTrack={() => {
                        // store doesn't expose removeTrack yet; no-op placeholder
                        console.warn('removeTrack not yet implemented')
                      }}
                    />
                  )
                }}
              </For>

              {/* add property row */}
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

      {/* CSS tab */}
      <Show when={activeTab() === 'css'}>
        <CodeView />
      </Show>
    </aside>
  )
}
