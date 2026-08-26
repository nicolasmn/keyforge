import { createSignal, createEffect, onCleanup, For, Show } from 'solid-js'
import { placeMenu } from '@/utils/menuPosition'

/**
 * App-wide right-click menu service (context-menus plan §3).
 *
 * Exactly ONE menu exists at a time: `open()` replaces state wholesale.
 * The host renders nothing until `open()` body-level-renders a fixed-position
 * `role="menu"` at viewport coords; placement flip/clamp comes from the
 * pure placeMenu() util. Full #48 lifecycle lives here so callers only
 * describe items: focus first enabled item, Arrow/Home/End rove,
 * Enter/Space activate (close → restore focus → run), and dismissal on
 * Escape / outside pointerdown / focus-out / window blur / scroll(capture).
 */
export type MenuItem =
  | {
      type: 'item'
      label: string
      onSelect: () => void
      disabled?: boolean
      danger?: boolean
      hint?: string
    }
  | { type: 'separator' }

export interface ContextMenuOptions {
  ariaLabel?: string
  onClose?: () => void
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
  ariaLabel: string
  onClose?: () => void
}

const [state, setState] = createSignal<MenuState | null>(null)
let restoreFocusTo: Element | null = null

function restoreFocus(): void {
  if (restoreFocusTo instanceof HTMLElement) restoreFocusTo.focus?.()
  restoreFocusTo = null
}

/** Dismissal WITHOUT selection — fires the caller's onClose. */
function dismiss(): void {
  const s = state()
  if (!s) return
  setState(null)
  s.onClose?.()
  restoreFocus()
}

/**
 * Item activation: closes WITHOUT firing onClose (a selection was made),
 * restores focus, then runs the action.
 */
function activate(item: Extract<MenuItem, { type: 'item' }>): void {
  setState(null)
  restoreFocus()
  item.onSelect()
}

/** Open (or move/replace) THE menu at viewport coordinates. */
export const contextMenu = {
  open(x: number, y: number, items: MenuItem[], opts?: ContextMenuOptions): void {
    // Reopening while open = move/replace; prior onClose is NOT fired —
    // nothing was dismissed without selection, it was superseded.
    restoreFocusTo = document.activeElement
    setState({ x, y, items, ariaLabel: opts?.ariaLabel ?? 'Context menu', onClose: opts?.onClose })
  },
  close: dismiss,
  isOpen(): boolean {
    return state() !== null
  },
}

/**
 * Mount once in <App/>. Renders the menu inline in the tree — position:fixed
 * makes document location irrelevant, so no portal is required.
 */
export function ContextMenuHost() {
  let menuEl: HTMLDivElement | undefined
  const [placed, setPlaced] = createSignal(false)

  // Measure-and-place after mount, then wire lifecycle listeners per-open.
  createEffect(() => {
    const s = state()
    if (!s || !menuEl) return
    setPlaced(false)
    queueMicrotask(() => {
      if (!menuEl) return
      const p = placeMenu(
        s.x,
        s.y,
        menuEl.offsetWidth,
        menuEl.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      )
      menuEl.style.left = `${p.left}px`
      menuEl.style.top = `${p.top}px`
      setPlaced(true)
      // Focus contract: first enabled item receives focus on open.
      menuEl.querySelector<HTMLElement>('.kf-ctx-menu__item:not(:disabled)')?.focus()
    })

    const onDocPointerDown = (e: PointerEvent) => {
      // Clicks ON the menu must reach their items: pointerdown bubbles to
      // document and would otherwise unmount the menu before click fires.
      if (menuEl && menuEl.contains(e.target as Node)) return
      dismiss()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        dismiss()
      }
    }
    const onBlur = () => dismiss()
    const onScroll = () => dismiss()
    const onResize = () => dismiss()
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    document.addEventListener('scroll', onScroll, { capture: true })
    window.addEventListener('resize', onResize)
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onResize)
    })
  })

  function onItemKeyDown(e: KeyboardEvent & { currentTarget: HTMLElement }) {
    const items = state()?.items ?? []
    const idx = Number(e.currentTarget.dataset.index ?? -1)
    const step = e.shiftKey ? -1 : 1 // Shift reverses direction, matching rove conventions
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      focusSibling(items, idx, +1)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      focusSibling(items, idx, -1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusSibling(items, -1, +1)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusSibling(items, items.length, -1)
    } else if (step === -1 && e.key === 'Tab') {
      e.preventDefault()
      focusSibling(items, idx, -1)
    }
  }

  function focusSibling(items: MenuItem[], from: number, dir: number) {
    let i = from + dir
    while (i >= 0 && i < items.length) {
      const it = items[i]
      if (it.type !== 'separator' && !it.disabled) {
        menuEl?.querySelector<HTMLElement>(`[data-index='${i}']`)?.focus()
        return
      }
      i += dir
    }
  }

  return (
    <Show when={state()} keyed>
      {(s) => (
        <div
          ref={(el) => {
            menuEl = el
            setPlaced(false)
          }}
          class="kf-ctx-menu"
          role="menu"
          aria-label={s.ariaLabel}
          style={{
            position: 'fixed',
            left: '0px',
            top: '0px',
            visibility: placed() ? 'visible' : 'hidden',
            'z-index': '60',
          }}
          onKeyDown={onItemKeyDown}
          onContextMenu={(e) => e.preventDefault()}
        >
          <For each={s.items}>
            {(item, i) => (
              <Show
                when={item.type === 'item' ? item : undefined}
                fallback={<hr role="separator" class="kf-ctx-menu__sep" />}
              >
                {(item) => (
                  <button
                    role="menuitem"
                    type="button"
                    data-index={i()}
                    class="kf-ctx-menu__item"
                    classList={{ 'kf-ctx-menu__item--danger': item().danger }}
                    disabled={item().disabled}
                    onClick={() => activate(item())}
                  >
                    <span class="kf-ctx-menu__label">{item().label}</span>
                    <Show when={item().hint}>
                      <span class="kf-ctx-menu__hint">{item().hint}</span>
                    </Show>
                  </button>
                )}
              </Show>
            )}
          </For>
        </div>
      )}
    </Show>
  )
}
