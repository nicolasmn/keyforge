import { For, createSignal, untrack } from 'solid-js'
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  closestCenter,
  sortable as sortableDirective,
  type DragEvent,
} from '@thisbeyond/solid-dnd'
import '@/directives'
import {
  doc,
  selectedLayerId,
  setSelectedLayerId,
  addLayer,
  removeLayer,
  renameLayer,
  reorderLayer,
  setLayerVisibility,
} from '@/store'

function SortableLayer(props: {
  layer: (typeof doc.layers)[number]
  editingId: () => string | null
  onStartEdit: (e: MouseEvent, id: string) => void
  onCommit: (id: string, value: string) => void
  onKeyDown: (e: KeyboardEvent, id: string) => void
}) {
  const id = untrack(() => props.layer.id)
  const state = createSortable(id)
  // Directive must be referenced to prevent tree-shaking
  void sortableDirective

  return (
    <li
      use:sortable={state}
      class="layer-tree__item"
      classList={{
        'layer-tree__item--active': selectedLayerId() === props.layer.id,
        'layer-tree__item--hidden': !props.layer.visible,
        'layer-tree__item--dragging': state.isActiveDraggable,
      }}
      onClick={() => setSelectedLayerId(props.layer.id)}
    >
      <span class="layer-tree__drag-handle" title="Drag to reorder">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" />
          <circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" />
          <circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" />
        </svg>
      </span>

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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
          onDblClick={(e) => props.onStartEdit(e, props.layer.id)}
          title="Double-click to rename"
        >
          {props.layer.name}
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
        <button class="btn btn--ghost" onClick={addLayer} title="Add layer">+</button>
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
