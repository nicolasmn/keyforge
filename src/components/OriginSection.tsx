import { createSignal, For, onCleanup, Show } from 'solid-js'
import { clearLayerOrigin, getSelectedLayer, setLayerOrigin } from '@/store'
import { NumberUnitField } from './fields'
import {
  isValidOriginComponent,
  isValidOriginPair,
  ORIGIN_PRESETS,
  ORIGIN_UNITS,
  splitOriginComponent,
} from '@/utils/originMath'
import { registerPickTrigger, originPicking, setOriginPicking } from './originPickState'

/**
 * "Transform origin" section — sits ABOVE the track list because the origin
 * changes how every transform/rotate/scale track reads (plan §3).
 *
 * - Current-value chip ("25% · 80%" or "default · 50% 50%").
 * - [Pick on stage] toggle → shared pick-mode signal rendered by OriginOverlay.
 * - ⊞ Grid popover with the 9 preset buttons (keywords convert to % before storing).
 * - X/Y numeric fields reusing NumberUnitField, units limited to % px em rem vw vh;
 *   invalid input reverts via the existing onCancel flow; commits announce politely.
 */

type Axis = 'x' | 'y'

export default function OriginSection() {
  const layer = () => getSelectedLayer()
  const origin = () => layer()?.element.origin

  const [editingAxis, setEditingAxis] = createSignal<Axis | null>(null)
  const [gridOpen, setGridOpen] = createSignal(false)
  const [announce, setAnnounce] = createSignal('')

  let pickBtn: HTMLButtonElement | undefined

  // Exiting pick mode returns focus to this button (plan §3 gesture contract).
  onCleanup(registerPickTrigger(() => pickBtn?.focus()))

  function parsedComponent(axis: Axis): { num: string; unit: string } {
    const value = axis === 'x' ? origin()?.x : origin()?.y
    if (!value) return axis === 'x' ? { num: '50', unit: '%' } : { num: '50', unit: '%' }
    return splitOriginComponent(value) ?? { num: value.replace(/[^0-9.\-]/g, ''), unit: '%' }
  }

  /** Commit one axis, preserving the other; invalid input silently reverts. */
  function commitComponent(axis: Axis, num: string, unit: string) {
    setEditingAxis(null)
    const l = layer()
    const n = Number.parseFloat(num)
    if (!l || Number.isNaN(n)) return
    const value = `${num}${unit}`
    if (!isValidOriginComponent(value)) return
    const nx = axis === 'x' ? value : (origin()?.y ?? '50%')
    const ny = axis === 'y' ? value : (origin()?.x ?? '50%')
    if (!isValidOriginPair(nx, ny)) return
    setLayerOrigin(l.id, nx, ny)
    setAnnounce(`Origin set to ${nx} ${ny}`)
  }

  function applyPreset(x: number, y: number, aria: string) {
    const l = layer()
    if (!l) return
    setLayerOrigin(l.id, `${x}%`, `${y}%`)
    setAnnounce(`${aria} — Origin set to ${x}% ${y}%`)
  }

  function reset() {
    const l = layer()
    if (!l) return
    clearLayerOrigin(l.id)
    setEditingAxis(null)
    setAnnounce('Origin reset to CSS default (50% 50%)')
  }

  function togglePick() {
    setOriginPicking(!originPicking())
  }

  const summary = () => (origin() ? `${origin()!.x} · ${origin()!.y}` : 'default · 50% 50%')

  return (
    <section class="kf-origin-section" aria-label="Transform origin">
      <div class="kf-origin-section__head">
        <span class="kf-origin-section__title">Transform origin</span>
        <span class="kf-origin-chip" title={summary()}>
          {summary()}
        </span>
      </div>

      <div class="kf-origin-section__row">
        {/* Pick entry: aria-pressed toggle; focus returns here on exit. */}
        <button
          ref={(el) => {
            pickBtn = el
          }}
          type="button"
          class="btn btn--ghost kf-origin-pick-btn"
          classList={{ 'btn--active': originPicking() }}
          aria-pressed={originPicking()}
          onClick={togglePick}
          title="Pick the transform origin on the preview stage (Esc cancels)"
          aria-label="Pick on stage"
        >
          Pick on stage
        </button>

        {/* Preset grid popover */}
        <button
          type="button"
          class="btn btn--ghost kf-origin-grid-btn"
          aria-expanded={gridOpen()}
          aria-haspopup="true"
          onClick={() => setGridOpen((v) => !v)}
          title="9-point preset grid"
          aria-label="Preset grid"
        >
          ⊞ Grid
        </button>

        <button
          type="button"
          class="btn btn--ghost kf-origin-reset-btn"
          disabled={!origin()}
          onClick={reset}
          title="Reset to CSS default and remove the stored origin"
          aria-label="Reset transform origin to default"
        >
          Reset
        </button>
      </div>

      <Show when={gridOpen()}>
        <div class="kf-origin-grid" role="group" aria-label="Transform origin presets">
          <For each={ORIGIN_PRESETS}>
            {(p) => (
              <button
                type="button"
                title={p.aria}
                aria-label={`${p.aria} (${p.x}%, ${p.y}%)`}
                onClick={() => {
                  applyPreset(p.x, p.y, p.aria)
                  setGridOpen(false)
                }}
              >
                {p.label}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="kf-origin-section__axes">
        <For each={['x', 'y'] as const}>
          {(axis) => (
            <div class="kf-origin-axis">
              <span class="kf-origin-axis__label">{axis.toUpperCase()}</span>
              <Show
                when={editingAxis() === axis}
                fallback={
                  <button
                    type="button"
                    class="kf-chip kf-chip--number kf-origin-axis__chip"
                    aria-label={`Edit origin ${axis === 'x' ? 'horizontal' : 'vertical'} position, currently ${
                      axis === 'x' ? (origin()?.x ?? '50%') : (origin()?.y ?? '50%')
                    }`}
                    title="Click to edit"
                    onClick={() => setEditingAxis(axis)}
                  >
                    {axis === 'x' ? (origin()?.x ?? '50%') : (origin()?.y ?? '50%')}
                  </button>
                }
              >
                <NumberUnitField
                  numStr={parsedComponent(axis).num}
                  unit={parsedComponent(axis).unit}
                  allowedUnitsOverride={ORIGIN_UNITS}
                  onCommit={(num, unit) => commitComponent(axis, num, unit)}
                  onCancel={() => setEditingAxis(null)}
                />
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* Polite announcements mirror CodeView's statusbar pattern (plan §3). */}
      <span class="kf-origin-status" role="status" aria-live="polite">
        {announce()}
      </span>
    </section>
  )
}
