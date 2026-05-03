/**
 * SplitLayout — wires Split.js into the desktop app shell.
 *
 * Two split instances:
 *   1. Horizontal: LayerTree | Preview | Inspector
 *   2. Vertical:   top workspace | Timeline area
 *
 * Split.js mutates element widths/heights directly via inline styles.
 * We give it DOM refs after mount; onCleanup destroys both instances.
 *
 * Double-click any gutter → resets that split to default sizes.
 */
import { onMount, onCleanup, type JSX } from 'solid-js'
import Split from 'split.js'

interface Props {
  layerTree: JSX.Element
  preview: JSX.Element
  inspector: JSX.Element
  timelineArea: JSX.Element
}

function makeGutter(direction: 'horizontal' | 'vertical'): HTMLElement {
  const g = document.createElement('div')
  g.className = `gutter gutter--${direction}`
  return g
}

export default function SplitLayout(props: Props) {
  let topRowRef!: HTMLDivElement
  let layerTreeRef!: HTMLDivElement
  let previewRef!: HTMLDivElement
  let inspectorRef!: HTMLDivElement
  let timelineRef!: HTMLDivElement

  onMount(() => {
    const hSplit = Split(
      [layerTreeRef, previewRef, inspectorRef],
      {
        sizes: [18, 56, 26],
        minSize: [160, 300, 220],
        maxSize: [320, Infinity, 400],
        gutterSize: 4,
        snapOffset: 0,
        direction: 'horizontal',
        cursor: 'col-resize',
        gutter(_index, direction) {
          return makeGutter(direction)
        },
      },
    )

    const vSplit = Split(
      [topRowRef, timelineRef],
      {
        sizes: [70, 30],
        minSize: [200, 120],
        maxSize: [Infinity, Math.round(window.innerHeight * 0.5)],
        gutterSize: 4,
        snapOffset: 0,
        direction: 'vertical',
        cursor: 'row-resize',
        gutter(_index, direction) {
          return makeGutter(direction)
        },
      },
    )

    document.querySelectorAll<HTMLElement>('.gutter--horizontal').forEach((g) => {
      g.addEventListener('dblclick', () => hSplit.setSizes([18, 56, 26]))
    })
    document.querySelectorAll<HTMLElement>('.gutter--vertical').forEach((g) => {
      g.addEventListener('dblclick', () => vSplit.setSizes([70, 30]))
    })

    onCleanup(() => {
      hSplit.destroy()
      vSplit.destroy()
    })
  })

  return (
    <div class="split-shell">
      <div class="split-top-row" ref={topRowRef}>
        <div class="split-panel split-panel--sidebar" ref={layerTreeRef}>
          {props.layerTree}
        </div>
        <div class="split-panel split-panel--preview" ref={previewRef}>
          {props.preview}
        </div>
        <div class="split-panel split-panel--inspector" ref={inspectorRef}>
          {props.inspector}
        </div>
      </div>
      <div class="split-panel split-panel--timeline" ref={timelineRef}>
        {props.timelineArea}
      </div>
    </div>
  )
}
