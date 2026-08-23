import { describe, it, expect } from 'vitest'
import {
  parseTransformStack,
  addTransformFn,
  removeTransformFn,
  moveTransformFn,
  ADDABLE_TRANSFORM_FNS,
} from './transformStack'

describe('parseTransformStack', () => {
  it('parses multi-function values', () => {
    expect(parseTransformStack('translateX(40px) rotate(45deg)')).toEqual([
      { name: 'translateX', args: '40px' },
      { name: 'rotate', args: '45deg' },
    ])
  })

  it('parses multi-arg functions and normalizes whitespace', () => {
    expect(parseTransformStack('translate(10px ,  20px) scale(2)')).toEqual([
      { name: 'translate', args: '10px ,  20px' },
      { name: 'scale', args: '2' },
    ])
  })

  it('returns empty for none/garbage', () => {
    expect(parseTransformStack('none')).toEqual([])
    expect(parseTransformStack('')).toEqual([])
  })
})

describe('addTransformFn', () => {
  it('appends with default args to an existing stack', () => {
    expect(addTransformFn('translateX(40px)', 'rotate')).toBe('translateX(40px) rotate(0deg)')
  })

  it('replaces none with the first function', () => {
    expect(addTransformFn('none', 'scale')).toBe('scale(1)')
  })

  it('ignores unknown function names', () => {
    expect(addTransformFn('scale(1)', 'frobnicate')).toBe('scale(1)')
  })

  it('every addable name has default args (by construction)', () => {
    for (const name of ADDABLE_TRANSFORM_FNS) {
      expect(addTransformFn('none', name)).toContain(`${name}(`)
    }
  })
})

describe('removeTransformFn', () => {
  it('removes by index and keeps others', () => {
    const v = 'translateX(40px) rotate(45deg) scale(2)'
    expect(removeTransformFn(v, 1)).toBe('translateX(40px) scale(2)')
  })

  it('returns none when the last function is removed', () => {
    expect(removeTransformFn('rotate(10deg)', 0)).toBe('none')
  })

  it('is a no-op for out-of-range indices', () => {
    expect(removeTransformFn('scale(1)', 5)).toBe('scale(1)')
  })
})

describe('moveTransformFn', () => {
  const v = 'a(1px) b(2px) c(3px)'

  it('moves left', () => {
    expect(moveTransformFn(v, 1, -1)).toBe('b(2px) a(1px) c(3px)')
  })

  it('moves right', () => {
    expect(moveTransformFn(v, 1, 1)).toBe('a(1px) c(3px) b(2px)')
  })

  it('clamps at both ends', () => {
    expect(moveTransformFn(v, 0, -1)).toBe(v)
    expect(moveTransformFn(v, 2, 1)).toBe(v)
  })
})
