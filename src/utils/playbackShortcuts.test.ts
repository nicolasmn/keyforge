import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type * as StoreModule from '@/store'
import { undo, redo } from '@/store'
import { installGlobalShortcuts, isTypingTarget } from './playbackShortcuts'

vi.mock('@/store', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof StoreModule
  return {
    ...actual,
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
  }
})

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

// ── installGlobalShortcuts: undo/redo keys ──────────────────────────────
//
// Node test env: no real Window/KeyboardEvent — stub the listener registry
// and dispatch plain objects shaped like the KeyboardEvent fields the
// handler reads. undo/redo are module mocks asserted via call counts.

const undoMock = vi.mocked(undo)
const redoMock = vi.mocked(redo)

type KeyHandler = (e: Partial<KeyboardEvent>) => void
let keydown: KeyHandler | null = null

function pressKey(fields: Partial<KeyboardEvent> & { target?: EventTarget | null }) {
  let prevented = false
  keydown?.({
    preventDefault: () => {
      prevented = true
    },
    ...fields,
  } as unknown as KeyboardEvent)
  return prevented
}

beforeEach(() => {
  vi.clearAllMocks()
  keydown = null
  const registry: Record<string, KeyHandler> = {}
  vi.stubGlobal('window', {
    addEventListener: (type: string, handler: KeyHandler) => {
      registry[type] = handler
    },
    removeEventListener: (type: string) => {
      delete registry[type]
    },
  })
  installGlobalShortcuts()
  keydown = registry['keydown'] ?? null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('installGlobalShortcuts: undo/redo keys', () => {
  it('Cmd/Ctrl+Z triggers undo and prevents the browser default', () => {
    expect(pressKey({ metaKey: true, key: 'z', target: fakeEl() })).toBe(true)
    expect(undoMock).toHaveBeenCalledTimes(1)
    expect(redoMock).not.toHaveBeenCalled()
  })

  it("uppercase 'Z' without shiftKey still undoes (caps-lock input)", () => {
    expect(pressKey({ ctrlKey: true, key: 'Z', target: fakeEl() })).toBe(true)
    expect(undoMock).toHaveBeenCalledTimes(1)
  })

  it('Cmd/Ctrl+Shift+Z triggers redo', () => {
    expect(pressKey({ ctrlKey: true, shiftKey: true, key: 'Z', target: fakeEl() })).toBe(true)
    expect(redoMock).toHaveBeenCalledTimes(1)
    expect(undoMock).not.toHaveBeenCalled()

    expect(pressKey({ metaKey: true, shiftKey: true, key: 'z', target: fakeEl() })).toBe(true)
    expect(redoMock).toHaveBeenCalledTimes(2)
  })

  it('Ctrl+Y triggers redo; Cmd+Y stays unclaimed (browser history on macOS)', () => {
    expect(pressKey({ ctrlKey: true, key: 'y', target: fakeEl() })).toBe(true)
    expect(redoMock).toHaveBeenCalledTimes(1)

    expect(pressKey({ metaKey: true, key: 'y', target: fakeEl() })).toBe(false)
    expect(redoMock).toHaveBeenCalledTimes(1) // unchanged
  })

  it('typing targets keep their native undo (handler does not fire)', () => {
    for (const target of [
      fakeEl({ tagName: 'INPUT' }),
      fakeEl({ tagName: 'TEXTAREA' }),
      fakeEl({ isContentEditable: true }),
    ]) {
      expect(pressKey({ metaKey: true, key: 'z', target })).toBe(false)
      expect(pressKey({ ctrlKey: true, shiftKey: true, key: 'Z', target })).toBe(false)
    }
    expect(undoMock).not.toHaveBeenCalled()
    expect(redoMock).not.toHaveBeenCalled()
  })

  it('plain z / y without modifier never triggers anything', () => {
    expect(pressKey({ key: 'z', target: fakeEl() })).toBe(false)
    expect(pressKey({ key: 'y', target: fakeEl() })).toBe(false)
    expect(undoMock).not.toHaveBeenCalled()
    expect(redoMock).not.toHaveBeenCalled()
  })
})
