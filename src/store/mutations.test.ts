import { describe, it, expect, beforeEach } from 'vitest'
import {
  doc,
  setDoc,
  addLayer,
  removeLayer,
  renameLayer,
  reorderLayer,
  setLayerVisibility,
  addTrack,
  addKeyframe,
  updateKeyframe,
  removeKeyframe,
  setDuration,
} from '@/store'
import type { AnimationDocument } from '@/types'
import { nanoid } from '@/utils/nanoid'

const blankDoc = (): AnimationDocument => ({
  id: nanoid(),
  name: 'Test',
  duration: 1000,
  layers: [],
})

beforeEach(() => {
  setDoc(blankDoc())
})

describe('addLayer', () => {
  it('adds a layer to the document', () => {
    expect(doc.layers).toHaveLength(0)
    addLayer()
    expect(doc.layers).toHaveLength(1)
  })

  it('increments layer name', () => {
    addLayer()
    addLayer()
    expect(doc.layers[1].name).toBe('Layer 2')
  })

  it('sets visible: true by default', () => {
    addLayer()
    expect(doc.layers[0].visible).toBe(true)
  })
})

describe('removeLayer', () => {
  it('removes the correct layer', () => {
    addLayer()
    addLayer()
    const id = doc.layers[0].id
    removeLayer(id)
    expect(doc.layers).toHaveLength(1)
    expect(doc.layers[0].id).not.toBe(id)
  })
})

describe('renameLayer', () => {
  it('updates the layer name', () => {
    addLayer()
    const id = doc.layers[0].id
    renameLayer(id, 'Hero Box')
    expect(doc.layers[0].name).toBe('Hero Box')
  })

  it('ignores empty string and keeps the original name', () => {
    addLayer()
    const id = doc.layers[0].id
    const original = doc.layers[0].name
    renameLayer(id, '   ')
    expect(doc.layers[0].name).toBe(original)
  })

  it('trims whitespace from valid name', () => {
    addLayer()
    const id = doc.layers[0].id
    renameLayer(id, '  Trimmed  ')
    expect(doc.layers[0].name).toBe('Trimmed')
  })
})

describe('reorderLayer', () => {
  it('moves a layer from one index to another', () => {
    addLayer() // Layer 1
    addLayer() // Layer 2
    addLayer() // Layer 3
    const ids = doc.layers.map((l) => l.id)
    reorderLayer(0, 2)
    expect(doc.layers[2].id).toBe(ids[0])
    expect(doc.layers[0].id).toBe(ids[1])
  })

  it('is a no-op when fromIndex === toIndex', () => {
    addLayer()
    addLayer()
    const ids = doc.layers.map((l) => l.id)
    reorderLayer(0, 0)
    expect(doc.layers.map((l) => l.id)).toEqual(ids)
  })

  it('moves last to first', () => {
    addLayer()
    addLayer()
    addLayer()
    const ids = doc.layers.map((l) => l.id)
    reorderLayer(2, 0)
    expect(doc.layers[0].id).toBe(ids[2])
    expect(doc.layers[1].id).toBe(ids[0])
    expect(doc.layers[2].id).toBe(ids[1])
  })

  it('preserves all layer ids after reorder', () => {
    addLayer()
    addLayer()
    addLayer()
    const ids = new Set(doc.layers.map((l) => l.id))
    reorderLayer(0, 2)
    expect(new Set(doc.layers.map((l) => l.id))).toEqual(ids)
  })
})

describe('setLayerVisibility', () => {
  it('hides a layer', () => {
    addLayer()
    const id = doc.layers[0].id
    setLayerVisibility(id, false)
    expect(doc.layers[0].visible).toBe(false)
  })

  it('shows a hidden layer', () => {
    addLayer()
    const id = doc.layers[0].id
    setLayerVisibility(id, false)
    setLayerVisibility(id, true)
    expect(doc.layers[0].visible).toBe(true)
  })

  it('does not affect other layers', () => {
    addLayer()
    addLayer()
    const id0 = doc.layers[0].id
    const id1 = doc.layers[1].id
    setLayerVisibility(id0, false)
    expect(doc.layers.find((l) => l.id === id1)?.visible).toBe(true)
  })
})

describe('addTrack', () => {
  it('adds a track to a layer', () => {
    addLayer()
    const layerId = doc.layers[0].id
    addTrack(layerId, 'opacity')
    expect(doc.layers[0].tracks).toHaveLength(1)
    expect(doc.layers[0].tracks[0].property).toBe('opacity')
  })
})

describe('addKeyframe', () => {
  it('adds a keyframe to a track', () => {
    addLayer()
    const layerId = doc.layers[0].id
    addTrack(layerId, 'opacity')
    const trackId = doc.layers[0].tracks[0].id
    addKeyframe(layerId, trackId, { time: 0, value: '0', easing: 'linear' })
    expect(doc.layers[0].tracks[0].keyframes).toHaveLength(1)
  })

  it('keeps keyframes sorted by time', () => {
    addLayer()
    const layerId = doc.layers[0].id
    addTrack(layerId, 'opacity')
    const trackId = doc.layers[0].tracks[0].id
    addKeyframe(layerId, trackId, { time: 500, value: '0.5', easing: 'linear' })
    addKeyframe(layerId, trackId, { time: 0, value: '0', easing: 'linear' })
    addKeyframe(layerId, trackId, { time: 1000, value: '1', easing: 'linear' })
    const times = doc.layers[0].tracks[0].keyframes.map((k) => k.time)
    expect(times).toEqual([0, 500, 1000])
  })
})

describe('updateKeyframe', () => {
  it('updates keyframe value', () => {
    addLayer()
    const layerId = doc.layers[0].id
    addTrack(layerId, 'opacity')
    const trackId = doc.layers[0].tracks[0].id
    addKeyframe(layerId, trackId, { time: 0, value: '0', easing: 'linear' })
    const kfId = doc.layers[0].tracks[0].keyframes[0].id
    updateKeyframe(layerId, trackId, kfId, { value: '0.5' })
    expect(doc.layers[0].tracks[0].keyframes[0].value).toBe('0.5')
  })

  it('re-sorts after time update', () => {
    addLayer()
    const layerId = doc.layers[0].id
    addTrack(layerId, 'opacity')
    const trackId = doc.layers[0].tracks[0].id
    addKeyframe(layerId, trackId, { time: 0, value: '0', easing: 'linear' })
    addKeyframe(layerId, trackId, { time: 1000, value: '1', easing: 'linear' })
    const kfId = doc.layers[0].tracks[0].keyframes[0].id
    updateKeyframe(layerId, trackId, kfId, { time: 800 })
    const times = doc.layers[0].tracks[0].keyframes.map((k) => k.time)
    expect(times).toEqual([800, 1000])
  })
})

describe('removeKeyframe', () => {
  it('removes the correct keyframe', () => {
    addLayer()
    const layerId = doc.layers[0].id
    addTrack(layerId, 'opacity')
    const trackId = doc.layers[0].tracks[0].id
    addKeyframe(layerId, trackId, { time: 0, value: '0', easing: 'linear' })
    addKeyframe(layerId, trackId, { time: 500, value: '0.5', easing: 'linear' })
    const kfId = doc.layers[0].tracks[0].keyframes[0].id
    removeKeyframe(layerId, trackId, kfId)
    expect(doc.layers[0].tracks[0].keyframes).toHaveLength(1)
    expect(doc.layers[0].tracks[0].keyframes[0].time).toBe(500)
  })
})

describe('setDuration', () => {
  it('updates document duration', () => {
    setDuration(3000)
    expect(doc.duration).toBe(3000)
  })
})
