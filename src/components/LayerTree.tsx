import { For, createSignal } from 'solid-js'
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

export default function LayerTree() {
  // Track which layer is being renamed
  const [editingId, setEditingId] = createSignal<string | null>(null)
  // Track drag state
  let dragFromIndex = -1

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

  function onDragStart(e: DragEvent, index: number) {
    dragFromIndex = index
    e.dataTransfer?.setData('text/plain', String(index))
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
  }

  function onDrop(e: DragEvent, toIndex: number) {
    e.preventDefault()
    if (dragFromIndex !== -1 && dragFromIndex !== toIndex) {
      reorderLayer(dragFromIndex, toIndex)
    }
    dragFromIndex = -1
  }

  return (
    <aside class="panel layer-tree">
      <div class="panel__header">
        <span>Layers</span>
        <button class="btn btn--ghost" onClick={addLayer} title="Add layer">
          +
        </button>
      </div>
      <ul class="layer-tree__list">
        <For each={doc.layers}>
          {(layer, index) => (
            <li
              class="layer-tree__item"
              classList={{
                'layer-tree__item--active': selectedLayerId() === layer.id,
                'layer-tree__item--hidden': !layer.visible,
              }}
              onClick={() => setSelectedLayerId(layer.id)}
              draggable={true}
              onDragStart={(e) => onDragStart(e, index())}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, index())}
            >
              {/* Drag handle */}
              <span class="layer-tree__drag-handle" title="Drag to reorder">‹›</span>

              {/* Visibility toggle */}
              <button
                class="btn btn--ghost layer-tree__visibility"
                onClick={(e) => {
                  e.stopPropagation()
                  setLayerVisibility(layer.id, !layer.visible)
                }}
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {layer.visible ? (
                  // Eye open
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  // Eye closed
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                )}
              </button>

              {/* Layer name — click-to-edit */}
              {editingId() === layer.id ? (
                <input
                  class="layer-tree__name-input"
                  value={layer.name}
                  autofocus
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => commitRename(layer.id, e.currentTarget.value)}
                  onKeyDown={(e) => onNameKeyDown(e, layer.id)}
                />
              ) : (
                <span
                  class="layer-tree__name"
                  onDblClick={(e) => startEdit(e, layer.id)}
                  title="Double-click to rename"
                >
                  {layer.name}
                </span>
              )}

              {/* Remove */}
              <button
                class="btn btn--ghost layer-tree__remove"
                onClick={(e) => {
                  e.stopPropagation()
                  removeLayer(layer.id)
                }}
                title="Remove layer"
              >
                ✕
              </button>
            </li>
          )}
        </For>
      </ul>
    </aside>
  )
}
