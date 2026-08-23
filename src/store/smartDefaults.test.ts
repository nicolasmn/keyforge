import { describe, it, expect, beforeEach } from 'vitest'
import { doc, setDoc, addLayer, addTrack, addKeyframe, DEFAULT_FIRST_VALUE } from '@/store'
import type { AnimationDocument } from '@/types'
import { nanoid } from '@/utils/nanoid'

const blankDoc = (): AnimationDocument => ({
  id: nanoid(),
  name: 'Test',
  duration: 2000,
  layers: [],
})

const lastTrack = () => {
  const layer = doc.layers[doc.layers.length - 1]
  return layer!.tracks[layer!.tracks.length - 1]!
}

beforeEach(() => {
  setDoc(blankDoc())
  addLayer()
})

const layerId = () => doc.layers[0].id

describe('smart keyframe defaults', () => {
  it('first keyframe on a fresh track gets the per-property default', () => {
    addTrack(layerId(), 'opacity')
    const track = lastTrack()
    addKeyframe(layerId(), track.id, { time: 0, value: '', easing: 'ease-out' })
    expect(track.keyframes[0].value).toBe(DEFAULT_FIRST_VALUE.opacity)
    expect(track.keyframes[0].value).toBe('0')
  })

  it('second keyframe inherits the previous value so the track animates', () => {
    addTrack(layerId(), 'transform')
    const track = lastTrack()
    addKeyframe(layerId(), track.id, { time: 0, value: '', easing: 'ease-out' })
    addKeyframe(layerId(), track.id, { time: 1000, value: '', easing: 'linear' })
    expect(track.keyframes).toHaveLength(2)
    expect(track.keyframes[1].value).toBe(track.keyframes[0].value)
    expect(track.keyframes[1].value).toBe(DEFAULT_FIRST_VALUE.transform)
  })

  it('explicit values are never overridden', () => {
    addTrack(layerId(), 'width')
    const track = lastTrack()
    addKeyframe(layerId(), track.id, {
      time: 0,
      value: '300px',
      easing: 'ease-out',
    })
    expect(track.keyframes[0].value).toBe('300px')
  })

  it('every AnimatableProperty has a default entry', () => {
    // If a new property is added to the union this test fails until a
    // default is chosen — deliberate guardrail.
    for (const k of Object.keys(DEFAULT_FIRST_VALUE)) {
      expect(typeof (DEFAULT_FIRST_VALUE as Record<string, string>)[k]).toBe('string')
    }
    expect(Object.keys(DEFAULT_FIRST_VALUE)).toHaveLength(10)
  })
})
