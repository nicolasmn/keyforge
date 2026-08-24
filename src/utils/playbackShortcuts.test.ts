import { describe, expect, it } from 'vitest'
import { isTypingTarget } from './playbackShortcuts'

/** Minimal fake element satisfying just what isTypingTarget reads. */
function fakeEl(overrides: Partial<HTMLElement> = {}): HTMLElement {
  return {
    tagName: 'DIV',
    isContentEditable: false,
    ...overrides,
  } as unknown as HTMLElement
}

describe('isTypingTarget', () => {
  it('returns false for null or plain focus targets', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(fakeEl())).toBe(false)
    expect(isTypingTarget(fakeEl({ tagName: 'BODY' }))).toBe(false)
  })

  it('treats inputs, textareas, selects as typing targets', () => {
    expect(isTypingTarget(fakeEl({ tagName: 'INPUT' }))).toBe(true)
    expect(isTypingTarget(fakeEl({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isTypingTarget(fakeEl({ tagName: 'SELECT' }))).toBe(true)
  })

  it('treats contenteditable elements as typing targets regardless of tag', () => {
    expect(isTypingTarget(fakeEl({ tagName: 'SPAN', isContentEditable: true }))).toBe(true)
  })
})
