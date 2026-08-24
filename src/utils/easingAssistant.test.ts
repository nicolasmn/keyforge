import { describe, it, expect } from 'vitest'
import { easeAllTrackKeyframes, EASY_EASE_EASING } from './easingAssistant'
import type { Track } from '@/types'

function makeTrack(specs: { time?: number; value?: string; easing?: string }[]): Track {
  return {
    id: 'track-1',
    property: 'opacity',
    keyframes: specs.map((k, i) => ({
      id: `kf-${i}`,
      time: k.time ?? i * 250,
      value: k.value ?? '1',
      easing: k.easing ?? 'linear',
    })),
  }
}

describe('easeAllTrackKeyframes', () => {
  it('sets the easy-ease easing on every keyframe and reports the count', () => {
    const track = makeTrack([{}, {}, {}])
    const calls: [string, string, string, { easing: string }][] = []
    const count = easeAllTrackKeyframes('layer-1', track, EASY_EASE_EASING, (...args) => {
      calls.push(args)
    })
    expect(count).toBe(3)
    expect(calls).toHaveLength(3)
    for (const [layerId, trackId, kfId, patch] of calls) {
      expect(layerId).toBe('layer-1')
      expect(trackId).toBe('track-1')
      expect(track.keyframes.some((kf) => kf.id === kfId)).toBe(true)
      expect(patch).toEqual({ easing: 'ease-out' })
    }
  })

  it('skips keyframes that already carry the target easing', () => {
    const track = makeTrack([{ easing: 'ease-out' }, { easing: 'linear' }])
    const touched: string[] = []
    const count = easeAllTrackKeyframes('l', track, 'ease-out', (_l, _t, kfId) => {
      touched.push(kfId)
    })
    expect(count).toBe(1)
    expect(touched).toEqual(['kf-1'])
  })

  it('is a no-op returning 0 for an empty track', () => {
    const track = makeTrack([])
    let called = false
    const count = easeAllTrackKeyframes('l', track, 'ease-out', () => {
      called = true
    })
    expect(count).toBe(0)
    expect(called).toBe(false)
  })

  it('uses ease-out as the Easy-ease equivalent (AE F9 mapping)', () => {
    expect(EASY_EASE_EASING).toBe('ease-out')
  })
})
