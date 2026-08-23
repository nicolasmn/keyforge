import { describe, it, expect } from 'vitest'
import { PROPERTY_REGISTRY, isValidNumberForProperty } from './propertyRegistry'
import type { AnimatableProperty } from '@/types'

const ALL: AnimatableProperty[] = [
  'opacity',
  'transform',
  'background-color',
  'color',
  'border-radius',
  'width',
  'height',
  'scale',
  'translate',
  'rotate',
]

describe('property registry', () => {
  it('covers every animatable property', () => {
    for (const p of ALL) {
      expect(PROPERTY_REGISTRY[p], p).toBeDefined()
      expect(typeof PROPERTY_REGISTRY[p].defaultValue, `${p} default`).toBe('string')
      expect(PROPERTY_REGISTRY[p].hint.length, `${p} hint`).toBeGreaterThan(0)
    }
  })

  it('registry count matches the property union', () => {
    expect(Object.keys(PROPERTY_REGISTRY)).toHaveLength(ALL.length)
  })

  it('opacity rejects length units and out-of-range numbers', () => {
    expect(isValidNumberForProperty('opacity', '40', 'px')).toBe(false)
    expect(isValidNumberForProperty('opacity', '0.4', '')).toBe(true)
    expect(isValidNumberForProperty('opacity', '1.5', '')).toBe(false)
  })

  it('width accepts px/%/em but not deg', () => {
    expect(isValidNumberForProperty('width', '100', 'px')).toBe(true)
    expect(isValidNumberForProperty('width', '50', '%')).toBe(true)
    expect(isValidNumberForProperty('width', '90', 'deg')).toBe(false)
    expect(isValidNumberForProperty('width', '-10', 'px')).toBe(false) // min 0
  })

  it('rotate accepts angle units only', () => {
    expect(isValidNumberForProperty('rotate', '45', 'deg')).toBe(true)
    expect(isValidNumberForProperty('rotate', '1', 'turn')).toBe(true)
    expect(isValidNumberForProperty('rotate', '45', 'px')).toBe(false)
  })

  it('color properties take no numeric units', () => {
    expect(isValidNumberForProperty('background-color', '10', 'px')).toBe(false)
  })
})
