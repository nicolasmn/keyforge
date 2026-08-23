import { describe, it, expect } from 'vitest'
import { createSampleDoc } from '@/utils/sampleDoc'

describe('createSampleDoc', () => {
  it('returns a document with the expected shape', () => {
    const doc = createSampleDoc()
    expect(doc.name).toBe('Sample animation')
    expect(doc.duration).toBe(2000)
    expect(doc.layers).toHaveLength(2)
  })

  it('gives every entity a non-empty id', () => {
    const doc = createSampleDoc()
    expect(doc.id.trim().length).toBeGreaterThan(0)
    for (const layer of doc.layers) {
      expect(layer.id.trim().length).toBeGreaterThan(0)
      for (const track of layer.tracks) {
        expect(track.id.trim().length).toBeGreaterThan(0)
        for (const kf of track.keyframes) {
          expect(kf.id.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('produces fresh ids on every call', () => {
    const a = createSampleDoc()
    const b = createSampleDoc()
    expect(a.id).not.toBe(b.id)
    expect(a.layers[0].id).not.toBe(b.layers[0].id)
    expect(a.layers[0].tracks[0].keyframes[0].id).not.toBe(b.layers[0].tracks[0].keyframes[0].id)
  })

  it('has at least 2 tracks per layer', () => {
    const doc = createSampleDoc()
    for (const layer of doc.layers) {
      expect(layer.tracks.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('places keyframes at different times with different values', () => {
    const doc = createSampleDoc()
    for (const layer of doc.layers) {
      for (const track of layer.tracks) {
        expect(track.keyframes.length).toBeGreaterThanOrEqual(2)
        const times = track.keyframes.map((k) => k.time)
        expect(new Set(times).size).toBe(times.length)
        const values = track.keyframes.map((k) => k.value)
        expect(new Set(values).size).toBeGreaterThan(1)
      }
    }
  })

  it('keeps all keyframes within the document duration', () => {
    const doc = createSampleDoc()
    for (const layer of doc.layers) {
      for (const track of layer.tracks) {
        for (const kf of track.keyframes) {
          expect(kf.time).toBeGreaterThanOrEqual(0)
          expect(kf.time).toBeLessThanOrEqual(doc.duration)
        }
      }
    }
  })

  it('animates opacity 0 → 1 → 0 on the first layer', () => {
    const doc = createSampleDoc()
    const box = doc.layers[0]
    const opacityTrack = box.tracks.find((t) => t.property === 'opacity')
    expect(opacityTrack?.keyframes.map((k) => k.value)).toEqual(['0', '1', '0'])
  })

  it('moves the first layer with translateY keyframes', () => {
    const doc = createSampleDoc()
    const box = doc.layers[0]
    const transformTrack = box.tracks.find((t) => t.property === 'transform')
    expect(transformTrack?.keyframes.map((k) => k.value)).toEqual([
      'translateY(40px)',
      'translateY(0px)',
    ])
  })
})
