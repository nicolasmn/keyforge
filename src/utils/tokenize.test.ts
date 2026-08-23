import { describe, it, expect } from 'vitest'
import { detectType, NUMBER_UNIT_RE } from './tokenize'

describe('NUMBER_UNIT_RE', () => {
  it('matches plain numbers without unit', () => {
    const m = NUMBER_UNIT_RE.exec('40')
    expect(m?.[1]).toBe('40')
    expect(m?.[2]).toBeUndefined()
  })

  it('captures value and unit', () => {
    const m = NUMBER_UNIT_RE.exec('1.5s')
    expect(m?.[1]).toBe('1.5')
    expect(m?.[2]).toBe('s')
  })

  it('supports negatives and decimals', () => {
    expect(NUMBER_UNIT_RE.test('-12.75deg')).toBe(true)
  })

  it('rejects non-numeric strings', () => {
    expect(NUMBER_UNIT_RE.test('ease-in')).toBe(false)
    expect(NUMBER_UNIT_RE.test('px')).toBe(false)
    expect(NUMBER_UNIT_RE.test('4 0px')).toBe(false)
  })
})

describe('detectType', () => {
  it('classifies transform functions', () => {
    expect(detectType('translateX(40px)', 'value')).toBe('transform')
    expect(detectType('translateX(40px) rotate(45deg)', 'value')).toBe('transform')
    expect(detectType('matrix3d(1, 0, 0, 0, 1)', 'value')).toBe('transform')
  })

  it('classifies colors', () => {
    expect(detectType('#ff8800', 'value')).toBe('color')
    expect(detectType('rgb(10, 20, 30)', 'value')).toBe('color')
  })

  it('treats bare words as string when CSS.supports is unavailable (node env)', () => {
    // In browsers the named-color heuristic would classify 'tomato' as color;
    // under the node test environment CSS is undefined and we fall through.
    expect(detectType('tomato', 'value')).toBe('string')
  })

  it('classifies numbers with units', () => {
    expect(detectType('250ms', 'value')).toBe('number')
    expect(detectType('42%', 'value')).toBe('number')
  })

  it('classifies easings', () => {
    expect(detectType('linear', 'easing')).toBe('easing')
    expect(detectType('cubic-bezier(0.4, 0, 0.2, 1)', 'value')).toBe('easing')
  })

  it('falls back to string for unknown values', () => {
    expect(detectType('some-unknown-thing', 'value')).toBe('string')
  })

  it('forces easing field to easing type', () => {
    expect(detectType('whatever', 'easing')).toBe('easing')
  })
})
