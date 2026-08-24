import { For, createSignal, untrack } from 'solid-js'
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
  setLayerCollapsed,
} from '@/store'

function SortableLayer(props: {
  layer: (typeof doc.layers)[number]
  editingId: () => string | null
  onStartEdit: (e: MouseEvent, id: string) => void
  onCommit: (id: string, value: string) => void
  onKeyDown: (e: KeyboardEvent, id: string) => void
}) {
  // Variable MUST be named `sortable` — solid/jsx-no-undef checks the name after `use:`
  const sortable = createSortable(untrack(() => props.layer.id))

  return (
    <li
      use:sortable={sortable}
      class="layer-tree__item"
      classList={{
        'layer-tree__item--active': selectedLayerId() === props.layer.id,
        'layer-tree__item--hidden': !props.layer.visible,
        'layer-tree__item--dragging': sortable.isActiveDraggable,
      }}
      onClick={() => setSelectedLayerId(props.layer.id)}
    >
      <span class="layer-tree__drag-handle" title="Drag to reorder">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <circle cx="4" cy="3" r="1" />
          <circle cx="8" cy="3" r="1" />
          <circle cx="4" cy="6" r="1" />
          <circle cx="8" cy="6" r="1" />
          <circle cx="4" cy="9" r="1" />
          <circle cx="8" cy="9" r="1" />
        </svg>
      </span>

      {/* Collapse disclosure — the AT-discoverable control the canvas
          chevron mirrors (plan: canvas can't host real buttons). */}
      <button
        class="btn btn--ghost layer-tree__collapse"
        onClick={(e) => {
          e.stopPropagation()
          setLayerCollapsed(props.layer.id, !props.layer.collapsed)
        }}
        title={props.layer.collapsed ? 'Expand layer in timeline' : 'Collapse layer in timeline'}
        aria-label={
          props.layer.collapsed
            ? `Expand layer ${props.layer.name} in timeline`
            : `Collapse layer ${props.layer.name} in timeline`
        }
        aria-expanded={!props.layer.collapsed}
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
          classList={{ 'layer-tree__collapse--open': !props.layer.collapsed }}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      <button
        class="btn btn--ghost layer-tree__visibility"
        onClick={(e) => {
          e.stopPropagation()
          setLayerVisibility(props.layer.id, !props.layer.visible)
        }}
        title={props.layer.visible ? 'Hide layer' : 'Show layer'}
        aria-label={props.layer.visible ? 'Hide layer' : 'Show layer'}
      >
        {props.layer.visible ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        )}
      </button>

      {props.editingId() === props.layer.id ? (
        <input
          class="layer-tree__name-input"
          value={props.layer.name}
          autofocus
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => props.onCommit(props.layer.id, e.currentTarget.value)}
          onKeyDown={(e) => props.onKeyDown(e, props.layer.id)}
        />
      ) : (
        <span
          class="layer-tree__name"
          tabindex={0}
          role="button"
          aria-label={`Layer ${props.layer.name}. Press Enter or double-click to rename.`}
          onDblClick={(e) => props.onStartEdit(e, props.layer.id)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.stopPropagation()
              props.onStartEdit(e as unknown as MouseEvent, props.layer.id)
            }
          }}
          title="Double-click to rename"
        >
          {props.layer.name}
          <svg
            class="layer-tree__rename-hint"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </span>
      )}

      <button
        class="btn btn--ghost layer-tree__remove"
        onClick={(e) => {
          e.stopPropagation()
          removeLayer(props.layer.id)
        }}
        title="Remove layer"
      >
        ✕
      </button>
    </li>
  )
}

export default function LayerTree() {
  const [editingId, setEditingId] = createSignal<string | null>(null)

  function startEdit(e: MouseEvent, layerId: string) {
    e.stopPropagation()
    setEditingId(layerId)
  }

  function commitRename(layerId: string, value: string) {
    renameLayer(layerId, value)
    setEditingId(null)
  }

  function onNameKeyDown(e: KeyboardEvent, layerId: string) {
    if (e.key === 'Enter') commitRename(layerId, (e.currentTarget as HTMLInputElement).value)
    if (e.key === 'Escape') setEditingId(null)
  }

  function onDragEnd({ draggable, droppable }: DragEvent) {
    if (!droppable || draggable.id === droppable.id) return
    const fromIndex = doc.layers.findIndex((l) => l.id === draggable.id)
    const toIndex = doc.layers.findIndex((l) => l.id === droppable.id)
    if (fromIndex !== -1 && toIndex !== -1) reorderLayer(fromIndex, toIndex)
  }

  return (
    <aside class="panel layer-tree">
      <div class="panel__header">
        <span>Layers</span>
        <button class="btn btn--ghost" onClick={addLayer} title="Add layer">
          +
        </button>
      </div>
      <DragDropProvider onDragEnd={onDragEnd} collisionDetector={closestCenter}>
        <DragDropSensors />
        <ul class="layer-tree__list">
          <SortableProvider ids={doc.layers.map((l) => l.id)}>
            <For each={doc.layers}>
              {(layer) => (
                <SortableLayer
                  layer={layer}
                  editingId={editingId}
                  onStartEdit={startEdit}
                  onCommit={commitRename}
                  onKeyDown={onNameKeyDown}
                />
              )}
            </For>
          </SortableProvider>
        </ul>
        <DragOverlay>
          <div class="layer-tree__drag-ghost" />
        </DragOverlay>
      </DragDropProvider>
    </aside>
  )
}
