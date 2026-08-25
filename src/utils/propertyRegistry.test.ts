import { describe, it, expect } from 'vitest'
import { PROPERTY_REGISTRY, isValidNumberForProperty, toCssPropertyValue } from './propertyRegistry'
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
  'transform-origin',
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

  it('transform-origin accepts length units and defaults to center', () => {
    expect(isValidNumberForProperty('transform-origin', '25', '%')).toBe(true)
    expect(isValidNumberForProperty('transform-origin', '-10', 'px')).toBe(true)
    expect(isValidNumberForProperty('transform-origin', '90', 'deg')).toBe(false)
    expect(PROPERTY_REGISTRY['transform-origin'].defaultValue).toBe('50% 50%')
  })

  it('color properties take no numeric units', () => {
    expect(isValidNumberForProperty('background-color', '10', 'px')).toBe(false)
  })

  it('individual transform properties default to VALID individual syntax', () => {
    // The rotate property takes a bare angle — NOT rotate(angle), which is
    // a transform FUNCTION and invalid as a property value (browsers drop
    // the declaration entirely). Same for translate pairs and scale.
    expect(PROPERTY_REGISTRY.rotate.defaultValue).toBe('0deg')
    expect(PROPERTY_REGISTRY.translate.defaultValue).toBe('0px 0px')
    expect(PROPERTY_REGISTRY.scale.defaultValue).toBe('1')
    expect(PROPERTY_REGISTRY.rotate.defaultValue).not.toContain('(')
    expect(PROPERTY_REGISTRY.translate.defaultValue).not.toContain('(')
  })
})

describe('toCssPropertyValue', () => {
  it('converts transform-function syntax to bare-angle individual syntax for rotate', () => {
    expect(toCssPropertyValue('rotate', 'rotate(0deg)')).toBe('0deg')
    expect(toCssPropertyValue('rotate', 'rotate(360deg)')).toBe('360deg')
    expect(toCssPropertyValue('rotate', '-45deg')).toBe('-45deg') // already valid
    expect(toCssPropertyValue('rotate', '1turn')).toBe('1turn') // already valid
  })

  it('maps axis rotations and passes through unrecognized shapes untouched', () => {
    expect(toCssPropertyValue('rotate', 'rotateX(30deg)')).toBe('x 30deg')
    expect(toCssPropertyValue('rotate', 'rotateY(30deg)')).toBe('y 30deg')
    expect(toCssPropertyValue('rotate', 'calc(45deg * 2)')).toBe('calc(45deg * 2)')
  })

  it('converts function syntax for translate tracks', () => {
    expect(toCssPropertyValue('translate', 'translate(10px, 20px)')).toBe('10px 20px')
    expect(toCssPropertyValue('translate', 'translateY(40px)')).toBe('0px 40px')
    expect(toCssPropertyValue('translate', 'translateZ(5px)')).toBe('0px 0px 5px')
    expect(toCssPropertyValue('translate', '10px 20px')).toBe('10px 20px') // already valid
  })

  it('converts function syntax for scale tracks', () => {
    expect(toCssPropertyValue('scale', 'scale(2)')).toBe('2')
    expect(toCssPropertyValue('scale', 'scaleY(1.5)')).toBe('1 1.5')
    expect(toCssPropertyValue('scale', 'scale3d(1, 2, 3)')).toBe('1 2 3')
    expect(toCssPropertyValue('scale', '2.5')).toBe('2.5') // already valid
  })

  it('leaves non-individual properties alone', () => {
    expect(toCssPropertyValue('transform', 'translateY(40px) rotate(45deg)')).toBe(
      'translateY(40px) rotate(45deg)',
    )
    expect(toCssPropertyValue('opacity', '0.5')).toBe('0.5')
    expect(toCssPropertyValue('width', '80px')).toBe('80px')
  })
})
