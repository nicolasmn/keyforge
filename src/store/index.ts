import { createStore, produce } from 'solid-js/store'
import { createSignal } from 'solid-js'
import type { AnimationDocument, Layer, Track, Keyframe, AnimatableProperty } from '@/types'
import { nanoid } from '@/utils/nanoid'

// ── Default document ──────────────────────────────────────────────────
const defaultDoc: AnimationDocument = {
  id: nanoid(),
  name: 'Untitled',
  duration: 2000,
  layers: [
    {
      id: nanoid(),
      name: 'Box',
      visible: true,
      element: {
        tag: 'div',
        text: '',
        initialCss: 'width:80px;height:80px;background-color:hsl(264 80% 68%);border-radius:8px;',
      },
      tracks: [
        {
          id: nanoid(),
          property: 'opacity',
          keyframes: [
            { id: nanoid(), time: 0, value: '0', easing: 'ease-out' },
            { id: nanoid(), time: 1000, value: '1', easing: 'ease-out' },
          ],
        },
        {
          id: nanoid(),
          property: 'transform',
          keyframes: [
            {
              id: nanoid(),
              time: 0,
              value: 'translateY(40px)',
              easing: 'cubic-bezier(0.34,1.56,0.64,1)',
            },
            { id: nanoid(), time: 1000, value: 'translateY(0px)', easing: 'linear' },
          ],
        },
      ],
    },
  ],
}

// ── Store ─────────────────────────────────────────────────────────────
export const [doc, setDoc] = createStore<AnimationDocument>(defaultDoc)

// ── Selection ──────────────────────────────────────────────────────────
export const [selectedLayerId, setSelectedLayerId] = createSignal<string | null>(
  defaultDoc.layers[0]?.id ?? null,
)
export const [selectedKeyframeId, setSelectedKeyframeId] = createSignal<string | null>(null)

// ── Playhead ────────────────────────────────────────────────────────────
export const [playhead, setPlayhead] = createSignal(0) // ms
export const [playing, setPlaying] = createSignal(false)
export const [loop, setLoop] = createSignal(true)

// ── Mutations ───────────────────────────────────────────────────────────
export function addLayer() {
  const id = nanoid()
  setDoc(
    produce((d) => {
      d.layers.push({
        id,
        name: `Layer ${d.layers.length + 1}`,
        visible: true,
        element: {
          tag: 'div',
          text: '',
          initialCss: 'width:60px;height:60px;background-color:hsl(200 80% 60%);border-radius:4px;',
        },
        tracks: [],
      })
    }),
  )
  setSelectedLayerId(id)
}

export function removeLayer(layerId: string) {
  setDoc(
    produce((d) => {
      d.layers = d.layers.filter((l) => l.id !== layerId)
    }),
  )
  if (selectedLayerId() === layerId) setSelectedLayerId(doc.layers[0]?.id ?? null)
}

export function renameLayer(layerId: string, name: string) {
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (layer) layer.name = name.trim() || layer.name
    }),
  )
}

/** Move layer at `fromIndex` to `toIndex`. */
export function reorderLayer(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return
  setDoc(
    produce((d) => {
      const [layer] = d.layers.splice(fromIndex, 1)
      d.layers.splice(toIndex, 0, layer)
    }),
  )
}

export function setLayerVisibility(layerId: string, visible: boolean) {
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (layer) layer.visible = visible
    }),
  )
}

export function addTrack(layerId: string, property: AnimatableProperty) {
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (!layer) return
      layer.tracks.push({ id: nanoid(), property, keyframes: [] })
    }),
  )
}

export function addKeyframe(layerId: string, trackId: string, kf: Omit<Keyframe, 'id'>) {
  setDoc(
    produce((d) => {
      const track = d.layers.find((l) => l.id === layerId)?.tracks.find((t) => t.id === trackId)
      if (!track) return
      track.keyframes.push({ ...kf, id: nanoid() })
      track.keyframes.sort((a, b) => a.time - b.time)
    }),
  )
}

export function updateKeyframe(
  layerId: string,
  trackId: string,
  keyframeId: string,
  patch: Partial<Omit<Keyframe, 'id'>>,
) {
  setDoc(
    produce((d) => {
      const track = d.layers.find((l) => l.id === layerId)?.tracks.find((t) => t.id === trackId)
      if (!track) return
      const kf = track.keyframes.find((k) => k.id === keyframeId)
      if (!kf) return
      Object.assign(kf, patch)
      track.keyframes.sort((a, b) => a.time - b.time)
    }),
  )
}

export function removeKeyframe(layerId: string, trackId: string, keyframeId: string) {
  setDoc(
    produce((d) => {
      const track = d.layers.find((l) => l.id === layerId)?.tracks.find((t) => t.id === trackId)
      if (!track) return
      track.keyframes = track.keyframes.filter((k) => k.id !== keyframeId)
    }),
  )
}

export function setDuration(ms: number) {
  setDoc('duration', ms)
}

export function getSelectedLayer(): Layer | undefined {
  return doc.layers.find((l) => l.id === selectedLayerId())
}

export function getSelectedTrackAndKeyframe(): { track: Track; keyframe: Keyframe } | undefined {
  const kfId = selectedKeyframeId()
  if (!kfId) return undefined
  const layer = getSelectedLayer()
  if (!layer) return undefined
  for (const track of layer.tracks) {
    const kf = track.keyframes.find((k) => k.id === kfId)
    if (kf) return { track, keyframe: kf }
  }
  return undefined
}
