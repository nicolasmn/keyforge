import { describe, it, expect, beforeEach } from 'vitest'
import { addEasing, removeEasing, hasEasing, customEasings } from './easingLibrary'

describe('easingLibrary store', () => {
  beforeEach(() => {
    // reset the module-level signal between tests
    for (const e of [...customEasings()]) removeEasing(e.name)
  })

  it('adds a new easing', () => {
    addEasing('my-curve', 'cubic-bezier(0.1, 0.2, 0.3, 0.4)')
    expect(hasEasing('my-curve')).toBe(true)
    const entry = customEasings().find((e) => e.name === 'my-curve')
    expect(entry?.value).toBe('cubic-bezier(0.1, 0.2, 0.3, 0.4)')
  })

  it('upserts: re-adding the same name replaces the value, no duplicate', () => {
    addEasing('dup', 'cubic-bezier(0, 0, 1, 1)')
    addEasing('dup', 'cubic-bezier(0.5, 0.5, 0.5, 0.5)')
    const matches = customEasings().filter((e) => e.name === 'dup')
    expect(matches).toHaveLength(1)
    expect(matches[0].value).toBe('cubic-bezier(0.5, 0.5, 0.5, 0.5)')
  })

  it('trims whitespace around names and rejects blank names', () => {
    addEasing('  padded  ', 'cubic-bezier(0, 0, 1, 1)')
    expect(hasEasing('padded')).toBe(true)
    expect(customEasings().some((e) => e.name !== e.name.trim())).toBe(false)

    const before = customEasings().length
    addEasing('   ', 'cubic-bezier(0, 0, 1, 1)')
    addEasing('', 'cubic-bezier(0, 0, 1, 1)')
    expect(customEasings().length).toBe(before)
  })

  it('removeEasing deletes by name', () => {
    addEasing('gone-soon', 'cubic-bezier(0, 0, 1, 1)')
    expect(hasEasing('gone-soon')).toBe(true)
    removeEasing('gone-soon')
    expect(hasEasing('gone-soon')).toBe(false)
  })
})
