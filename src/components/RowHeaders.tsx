import { For, createSignal } from 'solid-js'
import {
  doc,
  selectedLayerId,
  setSelectedLayerId,
  renameLayer,
  setLayerVisibility,
  toggleLayerCollapsed,
} from '@/store'
import {
  headerEntries,
  HEADER_HEIGHT,
  type RowHeaderEntry,
  type TimelineRow,
} from '@/utils/rowModel'

/**
 * Real-DOM header column for the timeline (plan §2/§3): one absolutely-
 * positioned `.row-header` per canvas row, sharing `.timeline__scroll`'s
 * native scroller with the canvas — vertical scroll sync is designed out
 * because both surfaces consume the SAME buildRowModel memo and live in
 * the same scroll container.
 *
 * Layer bands host [chevron][eye][name] as real buttons/inputs (the AT
 * story the old canvas chevron could never tell); track bands keep their
 * property label as plain text. Reorder stays in LayerTree for Phase A —
 * this component is deliberately presentational about geometry only.
 */
export default function RowHeaders(props: { rows: readonly TimelineRow[] }) {
  const [editingId, setEditingId] = createSignal<string | null>(null)
  /** Name buttons by layer id so rename can hand focus back on commit/cancel. */
  const nameButtons = new Map<string, HTMLButtonElement>()

  function startEdit(layerId: string) {
    setEditingId(layerId)
  }

  function finishEdit(layerId: string, value: string | null) {
    // null = cancel (Esc); store trims + keeps prior name on empty strings.
    if (value !== null) renameLayer(layerId, value)
    setEditingId(null)
    nameButtons.get(layerId)?.focus()
  }

  return (
    <div class="row-headers" aria-label="Timeline row headers">
      {/* Ruler-height spacer: canvas draws its ruler above the first row;
          this keeps DOM entries aligned with their canvas counterparts. */}
      <div style={{ height: `${HEADER_HEIGHT}px`, 'flex-shrink': '0' }} aria-hidden="true" />
      <For each={headerEntries(props.rows)}>
        {(entry: RowHeaderEntry) =>
          entry.type === 'layer' ? (
            <LayerHeaderRow
              entry={entry}
              editingId={editingId()}
              onStartEdit={startEdit}
              onFinishEdit={finishEdit}
              registerNameButton={(el) => nameButtons.set(entry.layerId, el)}
            />
          ) : (
            <TrackHeaderRow entry={entry} />
          )
        }
      </For>
    </div>
  )
}

function LayerHeaderRow(props: {
  entry: Extract<RowHeaderEntry, { type: 'layer' }>
  editingId: string | null
  onStartEdit: (layerId: string) => void
  onFinishEdit: (layerId: string, value: string | null) => void
  registerNameButton: (el: HTMLButtonElement) => void
}) {
  // Reactive lookup — collapse/visibility/name changes re-render this row.
  const layer = () => doc.layers.find((l) => l.id === props.entry.layerId)
  const isSelected = () => selectedLayerId() === props.entry.layerId
  const isEditing = () => props.editingId === props.entry.layerId

  return (
    <div
      class="row-header row-header--layer"
      classList={{
        'row-header--selected': isSelected(),
        'row-header--hidden': layer()?.visible === false,
      }}
      style={{ top: `${props.entry.top}px`, height: `${props.entry.height}px` }}
      onClick={() => setSelectedLayerId(props.entry.layerId)}
    >
      <button
        type="button"
        class="btn btn--ghost row-header__chevron"
        classList={{ 'row-header__chevron--open': layer()?.collapsed !== true }}
        onClick={(e) => {
          e.stopPropagation()
          toggleLayerCollapsed(props.entry.layerId)
        }}
        title={layer()?.collapsed ? 'Expand layer in timeline' : 'Collapse layer in timeline'}
        aria-label={
          layer()?.collapsed
            ? `Expand layer ${layer()?.name} in timeline`
            : `Collapse layer ${layer()?.name} in timeline`
        }
        aria-expanded={layer()?.collapsed !== true}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      <button
        type="button"
        class="btn btn--ghost row-header__eye"
        onClick={(e) => {
          e.stopPropagation()
          setLayerVisibility(props.entry.layerId, !(layer()?.visible ?? true))
        }}
        title={layer()?.visible === false ? 'Show layer' : 'Hide layer'}
        aria-label={
          layer()?.visible === false ? `Show layer ${layer()?.name}` : `Hide layer ${layer()?.name}`
        }
        aria-pressed={layer()?.visible === false}
      >
        {layer()?.visible === false ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>

      {isEditing() ? (
        <input
          class="row-header__name-input"
          classList={{ 'row-header__name-input--hidden-layer': layer()?.visible === false }}
          value={layer()?.name ?? ''}
          aria-label={`Rename layer ${layer()?.name}`}
          ref={(el) => el.focus()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => props.onFinishEdit(props.entry.layerId, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              props.onFinishEdit(props.entry.layerId, e.currentTarget.value)
            } else if (e.key === 'Escape') {
              props.onFinishEdit(props.entry.layerId, null)
            }
          }}
        />
      ) : (
        <button
          type="button"
          class="row-header__name"
          ref={(el) => props.registerNameButton(el)}
          onClick={() => setSelectedLayerId(props.entry.layerId)}
          onDblClick={(e) => {
            e.stopPropagation()
            props.onStartEdit(props.entry.layerId)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'F2') {
              e.preventDefault()
              e.stopPropagation()
              props.onStartEdit(props.entry.layerId)
            }
          }}
          title={`${layer()?.name ?? ''} — double-click or press F2 to rename`}
        >
          {layer()?.name}
        </button>
      )}
    </div>
  )
}

function TrackHeaderRow(props: { entry: Extract<RowHeaderEntry, { type: 'track' }> }) {
  const info = () => {
    const layer = doc.layers.find((l) => l.id === props.entry.layerId)
    const track = layer?.tracks.find((t) => t.id === props.entry.trackId)
    return { layerName: layer?.name ?? '', property: track?.property ?? '' }
  }
  return (
    <div
      class="row-header row-header--track"
      classList={{
        'row-header--hidden':
          doc.layers.find((l) => l.id === props.entry.layerId)?.visible === false,
        'row-header--selected': selectedLayerId() === props.entry.layerId,
      }}
      style={{ top: `${props.entry.top}px`, height: `${props.entry.height}px` }}
      title={info().property}
      onClick={() => setSelectedLayerId(props.entry.layerId)}
    >
      {/* Plain-text property label — the canvas no longer draws any label text. */}
      {info().property}
    </div>
  )
}
