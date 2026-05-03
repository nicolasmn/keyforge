import { createSignal, For, Show } from 'solid-js'
import type { ValueToken, SubToken } from '@/types'
import { updateKeyframe } from '@/store'
import { NUMBER_UNIT_RE } from '@/utils/tokenize'
import EasingEditor from './EasingEditor'

interface Props {
  tokens: ValueToken[]
}

function commit(path: ValueToken['path'], value: string) {
  if (path.field === 'value') {
    updateKeyframe(path.layerId, path.trackId, path.keyframeId, { value })
  } else {
    updateKeyframe(path.layerId, path.trackId, path.keyframeId, {
      easing: value as Parameters<typeof updateKeyframe>[3]['easing'],
    })
  }
}

function validate(type: ValueToken['type'], value: string): boolean {
  if (type === 'color')  return CSS.supports('color', value)
  if (type === 'number') return NUMBER_UNIT_RE.test(value)
  if (type === 'easing') return value === 'linear' || /^cubic-bezier\(/.test(value)
  return value.length > 0
}

// ── Inline sub-token scrub for transform arguments ───────────────────────────
function SubTokenScrub(props: {
  sub: SubToken
  parentToken: ValueToken
}) {
  let scrubOrigin: { x: number; orig: number } | null = null
  const subValue = () => props.sub.value
  const subUnit  = () => props.sub.unit
  const [display, setDisplay] = createSignal(`${subValue()}${subUnit()}`)

  function rebuildAndCommit(newVal: number) {
    const updated = props.parentToken.subTokens!.map((st) =>
      st.argIndex === props.sub.argIndex
        ? { ...st, value: String(+newVal.toFixed(3)) }
        : st
    ) as SubToken[]
    const assembled = props.sub.assembler(updated)
    commit(props.parentToken.path, assembled)
    setDisplay(`${+newVal.toFixed(3)}${subUnit()}`)
  }

  function onPointerDown(e: PointerEvent) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    scrubOrigin = { x: e.clientX, orig: parseFloat(subValue()) }
  }
  function onPointerMove(e: PointerEvent) {
    if (!scrubOrigin) return
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    rebuildAndCommit(scrubOrigin.orig + (e.clientX - scrubOrigin.x) * mult)
  }
  function onPointerUp() { scrubOrigin = null }

  return (
    <span
      class="token token--number token--sub"
      title={`arg ${props.sub.argIndex % 100} · Drag · Shift×10 · Alt÷10`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {display()}
    </span>
  )
}

// ── Color swatch sub-component ────────────────────────────────────────────────
function ColorSwatch(props: { token: ValueToken }) {
  const value = () => props.token.value
  if (!CSS.supports('color', value())) return null

  return (
    <span
      class="token__swatch"
      style={{ background: value() }}
      onClick={(e) => {
        e.stopPropagation()
        const tmp = document.createElement('div')
        tmp.style.color = value()
        document.body.appendChild(tmp)
        const rgb = getComputedStyle(tmp).color
        document.body.removeChild(tmp)
        const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
        const input = document.createElement('input')
        input.type = 'color'
        if (m) {
          const h = (n: number) => n.toString(16).padStart(2, '0')
          input.value = `#${h(+m[1])}${h(+m[2])}${h(+m[3])}`
        }
        input.oninput  = () => commit(props.token.path, input.value)
        input.onchange = () => commit(props.token.path, input.value)
        input.click()
      }}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TokenView(props: Props) {
  const [editingId,       setEditingId]       = createSignal<string | null>(null)
  const [editingEasingId, setEditingEasingId] = createSignal<string | null>(null)
  const [editValue,       setEditValue]       = createSignal('')
  const [invalid,         setInvalid]         = createSignal(false)
  const [scrubOrigin,     setScrubOrigin]     = createSignal<{ x: number; orig: number; token: ValueToken } | null>(null)

  function tid(t: ValueToken) {
    return `${t.path.trackId}:${t.path.keyframeId}:${t.path.field}`
  }

  function startEdit(t: ValueToken) {
    if (t.type === 'easing') {
      const id = tid(t)
      setEditingEasingId(editingEasingId() === id ? null : id)
      return
    }
    if (t.type === 'transform') return
    setEditingId(tid(t))
    setEditValue(t.value)
    setInvalid(false)
  }

  function onInput(e: Event, t: ValueToken) {
    const v = (e.currentTarget as HTMLInputElement).value
    setEditValue(v)
    if (validate(t.type, v)) {
      setInvalid(false)
      commit(t.path, v)
    } else {
      setInvalid(true)
    }
  }

  function onKeyDown(e: KeyboardEvent, t: ValueToken) {
    if (e.key === 'Enter') {
      invalid() ? commit(t.path, t.value) : commit(t.path, editValue())
      setEditingId(null)
    } else if (e.key === 'Escape') {
      commit(t.path, t.value)
      setEditingId(null)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (!invalid()) commit(t.path, editValue())
      const all = props.tokens
      const idx = all.findIndex((tk) => tid(tk) === tid(t))
      const next = e.shiftKey
        ? all[(idx - 1 + all.length) % all.length]
        : all[(idx + 1) % all.length]
      setEditingId(null)
      setTimeout(() => startEdit(next), 0)
    }
  }

  function onBlur(t: ValueToken) {
    invalid() ? commit(t.path, t.value) : commit(t.path, editValue())
    setEditingId(null)
    setInvalid(false)
  }

  function onScrubDown(e: PointerEvent, t: ValueToken) {
    if (t.type !== 'number') return
    if (editingId() === tid(t)) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const m = NUMBER_UNIT_RE.exec(t.value)
    setScrubOrigin({ x: e.clientX, orig: m ? parseFloat(m[1]) : 0, token: t })
  }

  function onScrubMove(e: PointerEvent, t: ValueToken) {
    const o = scrubOrigin()
    if (!o || o.token !== t) return
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const delta = (e.clientX - o.x) * mult
    const m = NUMBER_UNIT_RE.exec(t.value)
    const unit = m ? (m[2] ?? '') : ''
    commit(t.path, `${+(o.orig + delta).toFixed(3)}${unit}`)
  }

  function onScrubUp() { setScrubOrigin(null) }

  const grouped = () => {
    const map = new Map<string, { trackId: string; kfId: string; tokens: ValueToken[] }>()
    for (const t of props.tokens) {
      const key = `${t.path.trackId}::${t.path.keyframeId}`
      if (!map.has(key)) map.set(key, { trackId: t.path.trackId, kfId: t.path.keyframeId, tokens: [] })
      map.get(key)!.tokens.push(t)
    }
    return [...map.values()]
  }

  return (
    <div class="token-view">
      <Show when={props.tokens.length === 0}>
        <p class="inspector__empty">No keyframes on this layer</p>
      </Show>
      <For each={grouped()}>
        {(group) => (
          <div class="token-view__group">
            <For each={group.tokens}>
              {(token) => {
                const id = () => tid(token)
                const isEditing    = () => editingId()       === id()
                const isEasingOpen = () => editingEasingId() === id()

                return (
                  <>
                    <span
                      class="token"
                      classList={{
                        [`token--${token.type}`]: true,
                        'token--editing':     isEditing(),
                        'token--error':       isEditing() && invalid(),
                        'token--easing-open': isEasingOpen(),
                      }}
                      title={token.type === 'number' ? 'Drag · Shift×10 · Alt÷10' : undefined}
                      onClick={() => !isEditing() && startEdit(token)}
                      onPointerDown={(e) => onScrubDown(e, token)}
                      onPointerMove={(e) => onScrubMove(e, token)}
                      onPointerUp={onScrubUp}
                    >
                      <Show when={token.type === 'color'}>
                        <ColorSwatch token={token} />
                      </Show>

                      <Show when={token.type === 'transform' && token.subTokens && token.subTokens.length > 0}>
                        <span class="token__fn-label">{token.value.split('(')[0]}(</span>
                        <For each={token.subTokens}>
                          {(sub, i) => (
                            <>
                              <SubTokenScrub sub={sub} parentToken={token} />
                              <Show when={i() < (token.subTokens!.length - 1)}>
                                <span class="token__sep">, </span>
                              </Show>
                            </>
                          )}
                        </For>
                        <span class="token__fn-label">)</span>
                      </Show>

                      <Show when={token.type !== 'transform'}>
                        <Show when={isEditing()}>
                          <input
                            class="token__input"
                            value={editValue()}
                            onInput={(e) => onInput(e, token)}
                            onKeyDown={(e) => onKeyDown(e, token)}
                            onBlur={() => onBlur(token)}
                            ref={(el) => setTimeout(() => el?.focus(), 0)}
                            style={{ width: `${Math.max(4, editValue().length)}ch` }}
                          />
                        </Show>
                        <Show when={!isEditing()}>
                          <span class="token__value">{token.value}</span>
                        </Show>
                      </Show>
                    </span>

                    <Show when={isEasingOpen()}>
                      <EasingEditor
                        value={token.value}
                        onChange={(v) => commit(token.path, v)}
                        onClose={() => setEditingEasingId(null)}
                      />
                    </Show>
                  </>
                )
              }}
            </For>
          </div>
        )}
      </For>
    </div>
  )
}
