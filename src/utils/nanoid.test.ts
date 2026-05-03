import { describe, it, expect } from 'vitest'
import { nanoid } from './nanoid'

describe('nanoid', () => {
  it('returns a string', () => {
    expect(typeof nanoid()).toBe('string')
  })

  it('default length is 10', () => {
    expect(nanoid()).toHaveLength(10)
  })

  it('respects custom length', () => {
    expect(nanoid(20)).toHaveLength(20)
  })

  it('generates unique IDs', () => {
    const ids = Array.from({ length: 100 }, () => nanoid())
    const unique = new Set(ids)
    expect(unique.size).toBe(100)
  })
})
