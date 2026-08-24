import { describe, it, expect, beforeEach } from 'vitest'
import { setKeyframeSelectionSource, consumeKeyframeSelectionSource } from './selectionSource'

describe('selectionSource', () => {
  beforeEach(() => {
    // Drain any hint left over by a previous test.
    consumeKeyframeSelectionSource()
  })

  it('returns null when nothing was set', () => {
    expect(consumeKeyframeSelectionSource()).toBeNull()
  })

  it('round-trips a canvas origin', () => {
    setKeyframeSelectionSource('canvas')
    expect(consumeKeyframeSelectionSource()).toBe('canvas')
  })

  it('round-trips an inspector origin', () => {
    setKeyframeSelectionSource('inspector')
    expect(consumeKeyframeSelectionSource()).toBe('inspector')
  })

  it('consumes the hint exactly once (read-and-clear)', () => {
    setKeyframeSelectionSource('canvas')
    expect(consumeKeyframeSelectionSource()).toBe('canvas')
    expect(consumeKeyframeSelectionSource()).toBeNull()
  })

  it('keeps only the most recent hint', () => {
    setKeyframeSelectionSource('inspector')
    setKeyframeSelectionSource('canvas')
    expect(consumeKeyframeSelectionSource()).toBe('canvas')
  })
})
