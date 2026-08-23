import { describe, it, expect, beforeEach } from 'vitest'
import { doc, setDoc, addLayer, addTrack, addKeyframe, updateKeyframe } from '@/store'
import type { AnimationDocument } from '@/types'
import { nanoid } from '@/utils/nanoid'

const blankDoc = (): AnimationDocument => ({
  id: nanoid(),
  name: 'Test',
  duration: 2000,
  layers: [],
})

beforeEach(() => {
  setDoc(blankDoc())
  addLayer()
})

function seededTrack() {
  addTrack(doc.layers[0].id, 'opacity')
  const track = doc.layers[0].tracks[0]
  addKeyframe(doc.layers[0].id, track.id, { time: 0, value: '0', easing: 'linear' })
  return doc.layers[0].tracks[0]
}

describe('updateKeyframe guardrails', () => {
  it('rejects empty value patches (would corrupt exports)', () => {
    const track = seededTrack()
    updateKeyframe(doc.layers[0].id, track.id, track.keyframes[0].id, { value: '   ' })
    expect(track.keyframes[0].value).toBe('0')
  })

  it('accepts legitimate values', () => {
    const track = seededTrack()
    updateKeyframe(doc.layers[0].id, track.id, track.keyframes[0].id, { value: '0.5' })
    expect(track.keyframes[0].value).toBe('0.5')
  })

  it('rejects negative times', () => {
    const track = seededTrack()
    updateKeyframe(doc.layers[0].id, track.id, track.keyframes[0].id, { time: -100 })
    expect(track.keyframes[0].time).toBe(0)
  })

  it('allows valid time updates', () => {
    const track = seededTrack()
    updateKeyframe(doc.layers[0].id, track.id, track.keyframes[0].id, { time: 1500 })
    expect(track.keyframes.find((k) => k.id === track.keyframes[0].id)!.time).toBe(1500)
  })
})
