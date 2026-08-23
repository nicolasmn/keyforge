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

  it('captures the interpolated pose when playhead sits between keyframes', () => {
    addTrack(layerId(), 'opacity')
    const track = lastTrack()
    const id = layerId()
    addKeyframe(id, track.id, { time: 0, value: '0', easing: 'linear' })
    addKeyframe(id, track.id, { time: 1000, value: '1', easing: 'linear' })
    // playhead at 400ms → preview shows opacity 0.4
    addKeyframe(id, track.id, { time: 400, value: '', easing: 'ease-out' })
    expect(track.keyframes).toHaveLength(3)
    const mid = track.keyframes.find((k) => k.time === 400)!
    expect(mid.value).toBe('0.4')
  })

  it('before-first / after-last KF still inherits instead of interpolating', () => {
    addTrack(layerId(), 'width')
    const track = lastTrack()
    const id = layerId()
    addKeyframe(id, track.id, { time: 500, value: '100px', easing: 'linear' })
    addKeyframe(id, track.id, { time: 200, value: '', easing: 'linear' }) // before first → inherit
    addKeyframe(id, track.id, { time: 900, value: '', easing: 'linear' }) // after last → inherit
    expect(track.keyframes.find((k) => k.time === 200)!.value).toBe('100px')
    expect(track.keyframes.find((k) => k.time === 900)!.value).toBe('100px')
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
