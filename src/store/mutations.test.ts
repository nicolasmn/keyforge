import { describe, it, expect, beforeEach } from 'vitest'
import {
  doc,
  setDoc,
  addLayer,
  removeLayer,
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
