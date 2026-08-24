import { describe, it, expect } from 'vitest'
import { createSampleDoc, createStarterBoxLayer } from '@/utils/sampleDoc'

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

  // ── Audit F20: sample motion must be visible ────────────────────────

  it('moves the Dot horizontally instead of rotating it (F20)', () => {
    const doc = createSampleDoc()
    const dot = doc.layers.find((l) => l.name === 'Dot')
    const transformTrack = dot?.tracks.find((t) => t.property === 'transform')
    const values = transformTrack?.keyframes.map((k) => k.value) ?? []
    // translateX sweep is visible on a radially-symmetric circle…
    expect(values).toEqual(['translateX(-60px)', 'translateX(60px)', 'translateX(-60px)'])
    // …whereas rotation on that shape produces zero visible change.
    expect(values.some((v) => v.includes('rotate('))).toBe(false)
  })

  it('ends the Dot sweep where it started so looped playback is seamless', () => {
    const doc = createSampleDoc()
    const dot = doc.layers.find((l) => l.name === 'Dot')
    const transformTrack = dot?.tracks.find((t) => t.property === 'transform')
    const kfs = transformTrack!.keyframes
    expect(kfs[0].value).toBe(kfs[kfs.length - 1].value)
    expect(kfs[kfs.length - 1].time).toBe(doc.duration)
  })

  it('adds a third beat — Box scale bounce after landing (technique variety)', () => {
    const doc = createSampleDoc()
    const box = doc.layers[0]
    const scaleTrack = box.tracks.find((t) => t.property === 'scale')
    expect(scaleTrack?.keyframes.map((k) => k.value)).toEqual(['1', '1.3', '1'])
    // The bounce happens after the translateY arrival (t=1000).
    expect(scaleTrack!.keyframes[0].time).toBe(1000)
    expect(scaleTrack!.keyframes.every((k) => k.time >= 1000)).toBe(true)
  })
})

describe('createStarterBoxLayer', () => {
  // The former first-run seed content, now behind "Add your first layer".

  it('is a pre-built Box layer named Box', () => {
    const layer = createStarterBoxLayer()
    expect(layer.name).toBe('Box')
    expect(layer.visible).toBe(true)
    expect(layer.element.tag).toBe('div')
    expect(layer.element.initialCss).toContain('width:80px')
  })

  it('ships with opacity and transform tracks ready to scrub', () => {
    const layer = createStarterBoxLayer()
    expect(layer.tracks.map((t) => t.property)).toEqual(['opacity', 'transform'])
    expect(layer.tracks[0].keyframes.map((k) => k.value)).toEqual(['0', '1'])
    expect(layer.tracks[1].keyframes.map((k) => k.value)).toEqual([
      'translateY(40px)',
      'translateY(0px)',
    ])
  })

  it('produces fresh ids on every call', () => {
    const a = createStarterBoxLayer()
    const b = createStarterBoxLayer()
    expect(a.id).not.toBe(b.id)
    expect(a.tracks[0].id).not.toBe(b.tracks[0].id)
    expect(a.tracks[0].keyframes[0].id).not.toBe(b.tracks[0].keyframes[0].id)
  })
})
