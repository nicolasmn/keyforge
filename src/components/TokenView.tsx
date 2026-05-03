import { createSignal, For, Show } from 'solid-js'
import type { ValueToken, TokenPath } from '@/types'
import { updateKeyframe } from '@/store'
import { NUMBER_UNIT_RE } from '@/utils/tokenize'
import EasingEditor from './EasingEditor'

interface Props {
  tokens: ValueToken[]
  layerId: string
}

function commitToken(path: TokenPath, value: string) {
  if (path.field === 'value') {
    updateKeyframe(path.layerId, path.trackId, path.keyframeId, { value })
  } else {
    // easing field — cast via unknown since EasingName is a union
    updateKeyframe(path.layerId, path.trackId, path.keyframeId, {
      easing: value as Parameters<typeof updateKeyframe>[3]['easing'],
    })
  }
}

export default function TokenView(props: Props) {
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [editingEasingId, setEditingEasingId] = createSignal<string | null>(null)
  const [editValue, setEditValue] = createSignal('')
  const [invalid, setInvalid] = createSignal(false)
  const [scrubOrigin, setScrubOrigin] = createSignal<{ x: number; orig: number; token: ValueToken } | null>(null)

  function tokenId(t: ValueToken) {
    return `${t.path.keyframeId}:${t.path.field}`
  }

  function startEdit(t: ValueToken) {
    if (t.type === 'easing') {
      const id = tokenId(t)
      setEditingEasingId(editingEasingId() === id ? null : id)
      return
    }
    setEditingId(tokenId(t))
    setEditValue(t.value)
    setInvalid(false)
  }

  function onEditInput(e: Event, t: ValueToken) {
    const v = (e.currentTarget as HTMLInputElement).value
    setEditValue(v)
    // Live preview for valid values
    if (validateToken(t.type, v)) {
      setInvalid(false)
      commitToken(t.path, v)
    } else {
      setInvalid(true)
    }
  }

  function onEditKeyDown(e: KeyboardEvent, t: ValueToken) {
    if (e.key === 'Enter') {
      if (!invalid()) {
        commitToken(t.path, editValue())
      } else {
        commitToken(t.path, t.value) // revert
      }
      setEditingId(null)
    } else if (e.key === 'Escape') {
      commitToken(t.path, t.value) // revert
      setEditingId(null)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (!invalid()) commitToken(t.path, editValue())
      const tokens = props.tokens
      const idx = tokens.findIndex((tk) => tokenId(tk) === tokenId(t))
      const next = e.shiftKey
        ? tokens[(idx - 1 + tokens.length) % tokens.length]
        : tokens[(idx + 1) % tokens.length]
      setEditingId(null)
      setTimeout(() => startEdit(next), 0)
    }
  }

  function onEditBlur(t: ValueToken) {
    if (!invalid()) {
      commitToken(t.path, editValue())
    } else {
      commitToken(t.path, t.value) // revert
    }
    setEditingId(null)
    setInvalid(false)
  }

  // Numeric scrub
  function onScrubStart(e: PointerEvent, t: ValueToken) {
    if (t.type !== 'number') return
    if (editingId() === tokenId(t)) return
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
    const unit = m ? m[2] ?? '' : ''
    const newVal = `${+(o.orig + delta).toFixed(3)}${unit}`
    commitToken(t.path, newVal)
  }

  function onScrubEnd() {
    setScrubOrigin(null)
  }

  function validateToken(type: ValueToken['type'], value: string): boolean {
    if (type === 'color') return CSS.supports('color', value)
    if (type === 'number') return NUMBER_UNIT_RE.test(value)
    if (type === 'easing') {
      return value === 'linear' || /^cubic-bezier\(/.test(value)
    }
    return value.length > 0
  }

  function colorSwatch(value: string) {
    if (!CSS.supports('color', value)) return null
    return (
      <span
        class="token__swatch"
        style={{ background: value }}
        onClick={(e) => {
          e.stopPropagation()
          const input = document.createElement('input')
          input.type = 'color'
          // Convert to hex for native picker
          const tmp = document.createElement('div')
          tmp.style.color = value
          document.body.appendChild(tmp)
          const computed = getComputedStyle(tmp).color
          document.body.removeChild(tmp)
          const m = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
          if (m) {
            const toHex = (n: number) => n.toString(16).padStart(2, '0')
            input.value = `#${toHex(+m[1])}${toHex(+m[2])}${toHex(+m[3])}`
          }
          input.oninput = () => commitToken({ layerId: props.layerId, trackId: '', keyframeId: '', field: 'value', ...{} }, input.value)
          input.onchange = () => commitToken({ ...{ layerId: props.layerId, trackId: '', keyframeId: '', field: 'value' } }, input.value)
          input.click()
        }}
      />
    )
  }

  // Group tokens by track/keyframe for rendering
  const grouped = () => {
    const map = new Map<string, { trackId: string; kfId: string; time?: number; tokens: ValueToken[] }>()
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
                const id = () => tokenId(token)
                const isEditing = () => editingId() === id()
                const isEasingOpen = () => editingEasingId() === id()

                return (
                  <>
                    <span
                      class="token"
                      classList={{
                        [`token--${token.type}`]: true,
                        'token--editing': isEditing(),
                        'token--error': isEditing() && invalid(),
                        'token--easing-open': isEasingOpen(),
                      }}
                      title={token.type === 'number' ? 'Drag to scrub · Shift×10 · Alt÷10' : undefined}
                      onClick={() => !isEditing() && startEdit(token)}
                      onPointerDown={(e) => onScrubStart(e, token)}
                      onPointerMove={(e) => onScrubMove(e, token)}
                      onPointerUp={onScrubEnd}
                    >
                      <Show when={token.type === 'color'}>
                        {colorSwatch(token.value)}
                      </Show>
                      <Show when={isEditing()}>
                        <input
                          class="token__input"
                          value={editValue()}
                          onInput={(e) => onEditInput(e, token)}
                          onKeyDown={(e) => onEditKeyDown(e, token)}
                          onBlur={() => onEditBlur(token)}
                          ref={(el) => setTimeout(() => el?.focus(), 0)}
                          style={{ width: `${Math.max(4, editValue().length)}ch` }}
                        />
                      </Show>
                      <Show when={!isEditing()}>
                        <span class="token__value">{token.value}</span>
                      </Show>
                    </span>
                    <Show when={isEasingOpen()}>
                      <EasingEditor
                        value={token.value}
                        onChange={(v) => commitToken(token.path, v)}
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
