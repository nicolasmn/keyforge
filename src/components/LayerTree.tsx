import { For } from 'solid-js'
import { doc, selectedLayerId, setSelectedLayerId, addLayer, removeLayer } from '@/store'

export default function LayerTree() {
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
          {(layer) => (
            <li
              class="layer-tree__item"
              classList={{ 'layer-tree__item--active': selectedLayerId() === layer.id }}
              onClick={() => setSelectedLayerId(layer.id)}
            >
              <span class="layer-tree__name">{layer.name}</span>
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
