import { For, Show, createSignal, untrack } from 'solid-js'
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  closestCenter,
  type DragEvent,
} from '@thisbeyond/solid-dnd'
import {
  doc,
  selectedLayerId,
  setSelectedLayerId,
  addLayer,
  removeLayer,
  renameLayer,
  reorderLayer,
  setLayerVisibility,
  toggleLayerCollapsed,
} from '@/store'
import { headerEntries, type RowHeaderEntry, type TimelineRow } from '@/utils/rowModel'

/**
 * Real-DOM header column for the timeline (plan §2/§3): one `.row-header`
 * per canvas row, sharing `.timeline__scroll`'s native scroller with the
 * canvas — vertical scroll sync is designed out because both surfaces
 * consume the SAME buildRowModel memo and live in the same scroll container.
 *
 * Phase B: this column is the SINGLE layer surface. Layer bands are dnd-
 * sortable (grip → reorderLayer), carry a hover ✕ (removeLayer), and the
 * column ends with a ghost "+ Add layer" row.
 */
/** Cross-component rename request (context-menus plan §6.4): the timeline
 * canvas menu points at this; the header column's own editor consumes it.
 * Keeps ONE rename editor implementation. */
export const [renameTargetId, requestLayerRename] = createSignal<string | null>(null)

export default function RowHeaders(props: { rows: readonly TimelineRow[] }) {
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [draggedId, setDraggedId] = createSignal<string | null>(null)
  // Context-menu rename bus: an external requestLayerRename(id) opens the
  // same inline editor as a direct name click (one editor implementation).
  const effectiveEditingId = () => editingId() ?? renameTargetId()
  /** Name buttons by layer id so rename can hand focus back on commit/cancel. */
  const nameButtons = new Map<string, HTMLButtonElement>()

  function startEdit(layerId: string) {
    setEditingId(layerId)
  }

  function finishEdit(layerId: string, value: string | null) {
    // null = cancel (Esc); store trims + keeps prior name on empty strings.
    if (value !== null) renameLayer(layerId, value)
    setEditingId(null)
    requestLayerRename(null)
    nameButtons.get(layerId)?.focus()
  }

  function onDragEnd({ draggable, droppable }: DragEvent) {
    setDraggedId(null)
    if (!droppable || draggable.id === droppable.id) return
    const fromIndex = doc.layers.findIndex((l) => l.id === draggable.id)
    const toIndex = doc.layers.findIndex((l) => l.id === droppable.id)
    if (fromIndex !== -1 && toIndex !== -1) reorderLayer(fromIndex, toIndex)
  }

  const draggedLayer = () => doc.layers.find((l) => l.id === draggedId())

  return (
    <div class="row-headers" aria-label="Timeline row headers">
      <DragDropProvider
        onDragEnd={onDragEnd}
        onDragStart={(e) => setDraggedId(String(e.draggable.id))}
        collisionDetector={closestCenter}
      >
        <DragDropSensors />
        <SortableProvider ids={doc.layers.map((l) => l.id)}>
          <For each={headerEntries(props.rows)}>
            {(entry: RowHeaderEntry) =>
              entry.type === 'layer' ? (
                <LayerHeaderRow
                  entry={entry}
                  draggedId={draggedId()}
                  effectiveEditingId={effectiveEditingId()}
                  onStartEdit={startEdit}
                  onFinishEdit={finishEdit}
                  registerNameButton={(el) => nameButtons.set(entry.layerId, el)}
                />
              ) : (
                <TrackHeaderRow entry={entry} />
              )
            }
          </For>
        </SortableProvider>
        <DragOverlay>
          {draggedLayer() && (
            <div class="row-header row-header--layer row-header--drag-ghost">
              {draggedLayer()!.name}
            </div>
          )}
        </DragOverlay>
      </DragDropProvider>
      {/* Ghost add-row: the layer surface's "+" (single layer surface). */}
      <button
        type="button"
        class="row-header__add"
        onClick={addLayer}
        title="Add layer"
        aria-label="Add layer"
      >
        + Add layer
      </button>
    </div>
  )
}

function LayerHeaderRow(props: {
  entry: Extract<RowHeaderEntry, { type: 'layer' }>
  draggedId: string | null
  effectiveEditingId: string | null
  onStartEdit: (layerId: string) => void
  onFinishEdit: (layerId: string, value: string | null) => void
  registerNameButton: (el: HTMLButtonElement) => void
}) {
  // Variable MUST be named `sortable` — solid/jsx-no-undef checks the name after `use:`
  const sortable = createSortable(untrack(() => props.entry.layerId))
  // Reactive lookup — collapse/visibility/name changes re-render this row.
  const layer = () => doc.layers.find((l) => l.id === props.entry.layerId)
  const isSelected = () => selectedLayerId() === props.entry.layerId
  const isEditing = () => props.effectiveEditingId === props.entry.layerId

  return (
    <div
      use:sortable={sortable}
      class="row-header row-header--layer"
      classList={{
        'row-header--selected': isSelected(),
        'row-header--hidden': layer()?.visible === false,
        'row-header--dragging': sortable.isActiveDraggable,
      }}
      style={{ height: `${props.entry.height}px` }}
      onClick={() => setSelectedLayerId(props.entry.layerId)}
    >
      {/* Reorder grip (Phase B: dnd lives on the header column). */}
      <span class="row-header__grip" title="Drag to reorder">
        <svg width="10" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="3" r="1" />
          <circle cx="8" cy="3" r="1" />
          <circle cx="4" cy="6" r="1" />
          <circle cx="8" cy="6" r="1" />
          <circle cx="4" cy="9" r="1" />
          <circle cx="8" cy="9" r="1" />
        </svg>
      </span>

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
        <ShowEye visible={layer()?.visible !== false} />
      </button>

      <Show
        when={!isEditing()}
        fallback={
          <NameInput
            layerId={props.entry.layerId}
            initial={layer()?.name ?? ''}
            onFinish={props.onFinishEdit}
          />
        }
      >
        <button
          type="button"
          ref={(el) => props.registerNameButton(el)}
          class="row-header__name"
          onClick={(e) => {
            e.stopPropagation()
            props.onStartEdit(props.entry.layerId)
          }}
          title="Rename layer"
        >
          {layer()?.name}
        </button>
      </Show>

      <button
        type="button"
        class="btn btn--ghost row-header__remove"
        onClick={(e) => {
          e.stopPropagation()
          removeLayer(props.entry.layerId)
        }}
        title={`Delete layer ${layer()?.name}`}
        aria-label={`Delete layer ${layer()?.name}`}
      >
        ✕
      </button>
    </div>
  )
}

/** Inline rename input: Enter/blur commits, Esc cancels. */
function NameInput(props: {
  layerId: string
  initial: string
  onFinish: (layerId: string, value: string | null) => void
}) {
  let inputRef!: HTMLInputElement
  queueMicrotask(() => {
    inputRef?.focus()
    inputRef?.select()
  })
  return (
    <input
      ref={inputRef}
      class="row-header__name-input"
      value={props.initial}
      aria-label="Layer name"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
        e.stopPropagation()
        if (e.key === 'Enter') props.onFinish(props.layerId, e.currentTarget.value)
        else if (e.key === 'Escape') props.onFinish(props.layerId, null)
      }}
      onBlur={(e) => props.onFinish(props.layerId, e.currentTarget.value)}
    />
  )
}

function ShowEye(props: { visible: boolean }) {
  return (
    <Show
      when={props.visible}
      fallback={
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      }
    >
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
    </Show>
  )
}

function TrackHeaderRow(props: { entry: Extract<RowHeaderEntry, { type: 'track' }> }) {
  const layer = () => doc.layers.find((l) => l.id === props.entry.layerId)
  const track = () => layer()?.tracks.find((t) => t.id === props.entry.trackId)
  return (
    <div
      class="row-header row-header--track"
      classList={{ 'row-header--hidden': layer()?.visible === false }}
      style={{ height: `${props.entry.height}px` }}
    >
      {track()?.property}
    </div>
  )
}
