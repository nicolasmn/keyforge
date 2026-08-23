import { describe, it, expect } from 'vitest'
import { interpolatedValueAt, applyEasing } from './interpolate'
import type { Track, EasingName } from '@/types'

function trackOf(...kfs: Array<[number, string, string?]>): Track {
  return {
    id: 'T1',
    property: 'opacity',
    keyframes: kfs.map(([time, value, easing], i) => ({
      id: `K${i}`,
      time,
      value,
      easing: (easing ?? 'linear') as EasingName,
    })),
  }
}

describe('interpolatedValueAt', () => {
  const track = trackOf([0, '0'], [1000, '1'])

  it('returns exact keyframe values at their times', () => {
    expect(interpolatedValueAt(track, 0)).toBe('0')
    expect(interpolatedValueAt(track, 1000)).toBe('1')
  })

  it('lerps numerically between keyframes (linear)', () => {
    expect(interpolatedValueAt(track, 500)).toBe('0.5')
    expect(interpolatedValueAt(track, 250)).toBe('0.25')
  })

  it('holds before the first and after the last keyframe', () => {
    expect(interpolatedValueAt(track, -100)).toBe('0')
    expect(interpolatedValueAt(track, 2000)).toBe('1')
  })

  it('applies the leaving keyframe easing to progress', () => {
    // ease-in holds low values early: at t=0.5 ease-in(0.42,0,1,1) < 0.5
    const eased = trackOf([0, '0', 'ease-in'], [1000, '1'])
    const v = Number.parseFloat(interpolatedValueAt(eased, 500)!)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(0.5)
  })

  it('preserves units through interpolation', () => {
    const t = trackOf([0, '0px'], [1000, '100px'])
    expect(interpolatedValueAt(t, 250)).toBe('25px')
  })

  it('refuses mismatched units and holds instead', () => {
    const t = trackOf([0, '10px'], [1000, '50%'])
    expect(interpolatedValueAt(t, 500)).toBe('10px')
  })

  it('steps/holds non-numeric values (colors, transforms)', () => {
    const color = trackOf([0, '#ff0000'], [1000, '#00ff00'])
    expect(interpolatedValueAt(color, 400)).toBe('#ff0000')

    const tf = trackOf([0, 'translateY(40px)'], [1000, 'translateY(0px)'])
    expect(interpolatedValueAt(tf, 400)).toBe('translateY(40px)')
  })

  it('handles unsorted keyframe arrays', () => {
    const messy = trackOf([1000, '1'], [0, '0'])
    expect(interpolatedValueAt(messy, 500)).toBe('0.5')
  })

  it('returns null for empty tracks', () => {
    expect(interpolatedValueAt(trackOf(), 100)).toBeNull()
  })
})

describe('applyEasing', () => {
  it('is identity for linear and unknown easings', () => {
    expect(applyEasing(0.4, 'linear')).toBe(0.4)
    expect(applyEasing(0.4, 'not-a-real-easing')).toBe(0.4)
  })

  it('maps endpoints exactly for cubic-bezier', () => {
    expect(applyEasing(0, 'ease-out')).toBe(0)
    expect(applyEasing(1, 'ease-out')).toBeCloseTo(1, 5)
  })
})
