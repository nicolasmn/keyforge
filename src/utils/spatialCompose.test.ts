import { describe, it, expect } from 'vitest'
import {
  sampleTrackValue,
  mergeTransformTracks,
  composeSpatialTracks,
  toIndividualPropertyValue,
} from './spatialCompose'
import type { Track } from '@/types'
import { nanoid } from './nanoid'

function track(property: Track['property'], keys: Array<[number, string, string?]>): Track {
  return {
    id: nanoid(),
    property,
    keyframes: keys.map(([time, value, easing]) => ({
      id: nanoid(),
      time,
      value,
      easing: easing ?? 'linear',
    })),
  }
}

describe('sampleTrackValue', () => {
  const t = track('transform', [
    [0, 'translateY(0px)'],
    [1000, 'translateY(100px)'],
  ])

  it('holds the first/last value outside the keyframe range', () => {
    expect(sampleTrackValue(t, -50)).toBe('translateY(0px)')
    expect(sampleTrackValue(t, 2000)).toBe('translateY(100px)')
  })

  it('returns exact keyframe values at keyframe times', () => {
    expect(sampleTrackValue(t, 0)).toBe('translateY(0px)')
    expect(sampleTrackValue(t, 1000)).toBe('translateY(100px)')
  })

  it('lerps aligned transform stacks with eased progress', () => {
    // ease-in starts slow: at 25% of the segment the value must be well
    // below a quarter of the span (linear would be exactly 25px).
    const e = track('transform', [
      [0, 'translateY(0px)', 'ease-in'],
      [1000, 'translateY(100px)'],
    ])
    const v = Number.parseFloat(/translateY\((-?[\d.]+)px\)/.exec(sampleTrackValue(e, 250))![1])
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(25)
    expect(sampleTrackValue(t, 500)).toBe('translateY(50px)')
  })

  it('interpolates multi-function stacks element-wise', () => {
    const t2 = track('transform', [
      [0, 'translateX(0px) rotate(0deg)'],
      [2000, 'translateX(100px) rotate(90deg)'],
    ])
    expect(sampleTrackValue(t2, 1000)).toBe('translateX(50px) rotate(45deg)')
  })

  it('holds when stacks do not align (different function lists)', () => {
    const mis = track('transform', [
      [0, 'translateY(0px)'],
      [1000, 'rotate(90deg)'],
    ])
    expect(sampleTrackValue(mis, 500)).toBe('translateY(0px)')
  })

  it('lerps plain numeric values for non-transform properties', () => {
    const o = track('opacity', [
      [0, '0'],
      [1000, '1'],
    ])
    expect(sampleTrackValue(o, 250)).toBe('0.25')
  })

  it('holds across none↔fn boundaries instead of lerping (pinned semantics)', () => {
    // parseTransformStack('none') is empty so lerpStacks returns null → the
    // previous value holds. Stepped (not interpolated) motion at empty-stack
    // boundaries is intentional and acceptable; do not "fix" silently.
    const t = track('transform', [
      [0, 'none'],
      [1000, 'translateY(40px)'],
    ])
    expect(sampleTrackValue(t, 500)).toBe('none')
    expect(sampleTrackValue(t, 1500)).toBe('translateY(40px)')
  })
})

describe('mergeTransformTracks', () => {
  it('concatenates stacks in track order and keeps real key times exact', () => {
    const a = track('transform', [
      [0, 'translateY(0px)'],
      [2000, 'translateY(100px)'],
    ])
    const b = track('transform', [
      [0, 'rotate(0deg)'],
      [2000, 'rotate(90deg)'],
    ])
    const merged = mergeTransformTracks([a, b], 2000)
    expect(merged.property).toBe('transform')
    expect(merged.id).toBe(a.id)
    const atZero = merged.keyframes.find((k) => k.time === 0)!
    const atEnd = merged.keyframes.find((k) => k.time === 2000)!
    expect(atZero.value).toBe('translateY(0px) rotate(0deg)')
    expect(atEnd.value).toBe('translateY(100px) rotate(90deg)')
  })

  it('bakes eased progress into sampled stops (subdivision)', () => {
    const a = track('transform', [
      [0, 'translateY(0px)', 'ease-out'],
      [2000, 'translateY(100px)'],
    ])
    const b = track('transform', [
      [0, 'rotate(0deg)'],
      [2000, 'rotate(90deg)'],
    ])
    const merged = mergeTransformTracks([a, b], 2000)
    // ease-out forces intermediate samples between the union keys
    expect(merged.keyframes.length).toBeGreaterThan(3)
    const mid = merged.keyframes.find((k) => k.time === 1000)!
    // translateY (eased) runs AHEAD of half-way; rotate (linear) sits exactly
    // at half-way — BOTH move in the same composed value.
    const ty = Number.parseFloat(/translateY\((-?[\d.]+)px\)/.exec(mid.value)![1])
    const rot = Number.parseFloat(/rotate\((-?[\d.]+)deg\)/.exec(mid.value)![1])
    expect(ty).toBeGreaterThan(50)
    expect(rot).toBeCloseTo(45, 1)
  })

  it('keeps only union stops when every easing is linear', () => {
    const a = track('transform', [
      [0, 'translateY(0px)'],
      [1000, 'translateY(50px)'],
      [2000, 'translateY(100px)'],
    ])
    const b = track('transform', [
      [0, 'rotate(0deg)'],
      [2000, 'rotate(90deg)'],
    ])
    const merged = mergeTransformTracks([a, b], 2000)
    expect(merged.keyframes.map((k) => k.time)).toEqual([0, 1000, 2000])
  })

  it('all emitted stops carry linear timing (easing baked into values)', () => {
    const a = track('transform', [
      [0, 'translateY(0px)', 'cubic-bezier(0.34,1.56,0.64,1)'],
      [2000, 'translateY(100px)'],
    ])
    const b = track('transform', [[0, 'rotate(45deg)', 'ease-out']])
    const merged = mergeTransformTracks([a, b], 2000)
    for (const kf of merged.keyframes) expect(kf.easing).toBe('linear')
    // monotonic time ordering
    const times = merged.keyframes.map((k) => k.time)
    expect([...times].sort((x, y) => x - y)).toEqual(times)
  })

  it('clamps out-of-range keyframe times to the duration', () => {
    const a = track('transform', [
      [0, 'translateY(0px)'],
      [9999, 'translateY(100px)'],
    ])
    const b = track('transform', [[0, 'rotate(0deg)']])
    const merged = mergeTransformTracks([a, b], 2000)
    expect(Math.max(...merged.keyframes.map((k) => k.time))).toBeLessThanOrEqual(2000)
  })

  it("drops literal 'none' samples from merged stacks (#55 regression)", () => {
    // Track b starts as an empty stack ('none' — e.g. after delete-all in
    // the Inspector) then gains rotate(). 'none' is truthy, so the old
    // `.filter(Boolean)` kept it and emitted "… none" — invalid CSS that
    // makes browsers drop the whole merged declaration.
    const a = track('transform', [
      [0, 'translateX(10px)'],
      [1000, 'translateX(50px)'],
    ])
    const b = track('transform', [
      [0, 'none'],
      [1000, 'rotate(45deg)'],
    ])
    const merged = mergeTransformTracks([a, b], 1000)
    for (const kf of merged.keyframes) {
      expect(kf.value.includes('none')).toBe(false)
      expect(kf.value.trim()).not.toBe('')
    }
    const atZero = merged.keyframes.find((k) => k.time === 0)!
    expect(atZero.value).toBe('translateX(10px)')
    const atEnd = merged.keyframes.find((k) => k.time === 1000)!
    expect(atEnd.value).toBe('translateX(50px) rotate(45deg)')
  })

  it("emits 'none' when every source stack is empty at a stop", () => {
    const a = track('transform', [
      [0, 'none'],
      [500, 'scale(2)'],
    ])
    const b = track('transform', [
      [0, 'none'],
      [500, 'rotate(10deg)'],
    ])
    const merged = mergeTransformTracks([a, b], 1000)
    expect(merged.keyframes.find((k) => k.time === 0)!.value).toBe('none')
    // populated stops keep both functions
    const atMid = merged.keyframes.find((k) => k.time === 500)!
    expect(atMid.value).toBe('scale(2) rotate(10deg)')
  })
})

describe('composeSpatialTracks', () => {
  it('collapses duplicate transform tracks; passes others through in order', () => {
    const opacity = track('opacity', [[0, '0']])
    const a = track('transform', [[0, 'translateY(0px)']])
    const b = track('transform', [[0, 'rotate(0deg)']])
    const out = composeSpatialTracks([opacity, a, b], 2000)
    expect(out).toHaveLength(2)
    expect(out[0].property).toBe('opacity')
    expect(out[1].property).toBe('transform')
    expect(out[1].id).toBe(a.id)
  })

  it('leaves single transform tracks untouched', () => {
    const a = track('transform', [[0, 'translateY(0px)']])
    expect(composeSpatialTracks([a], 2000)).toEqual([a])
  })
})

describe('toIndividualPropertyValue', () => {
  it('rewrites legacy rotate() values to bare angles', () => {
    expect(toIndividualPropertyValue('rotate', 'rotate(90deg)')).toBe('90deg')
    expect(toIndividualPropertyValue('rotate', 'rotate(-0.5turn)')).toBe('-0.5turn')
    expect(toIndividualPropertyValue('rotate', '45deg')).toBe('45deg')
  })

  it('rewrites legacy translate() values to space-separated pairs', () => {
    expect(toIndividualPropertyValue('translate', 'translate(10px, 20px)')).toBe('10px 20px')
    expect(toIndividualPropertyValue('translate', 'translate(5%)')).toBe('5%')
    expect(toIndividualPropertyValue('translate', 'translateX(40px)')).toBe('40px')
    expect(toIndividualPropertyValue('translate', 'translateY(30px)')).toBe('0px 30px')
    expect(toIndividualPropertyValue('translate', '10px 20px')).toBe('10px 20px')
  })

  it('rewrites legacy scale() values to bare numbers', () => {
    expect(toIndividualPropertyValue('scale', 'scale(1.5)')).toBe('1.5')
    expect(toIndividualPropertyValue('scale', 'scale(1.5, 2)')).toBe('1.5 2')
  })

  it('passes through unrecognized values unchanged', () => {
    expect(toIndividualPropertyValue('rotate', 'garbage')).toBe('garbage')
    expect(toIndividualPropertyValue('opacity', 'rotate(90deg)')).toBe('rotate(90deg)')
  })
})
