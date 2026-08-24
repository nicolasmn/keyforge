import { describe, it, expect } from 'vitest'
import { createUndoStack } from './undoStack'

/**
 * Unit tests for the snapshot undo/redo stack. Snapshots are opaque —
 * plain strings keep the tests readable. The clock is injected so burst
 * coalescing is deterministic.
 */
describe('createUndoStack', () => {
  function makeStack(coalesceMs = 300) {
    let t = 0
    const stack = createUndoStack<string>({ now: () => t, coalesceMs })
    return {
      stack,
      tick: (ms: number) => {
        t += ms
      },
    }
  }

  describe('push / undo / redo basics', () => {
    it('undo returns the previous state and parks the current one for redo', () => {
      const { stack } = makeStack()
      expect(stack.canUndo()).toBe(false)

      stack.push('A') // user action → present becomes B
      expect(stack.canUndo()).toBe(true)
      expect(stack.undo('B')).toBe('A')
      expect(stack.canRedo()).toBe(true)
    })

    it('returns null when there is nothing to undo/redo', () => {
      const { stack } = makeStack()
      expect(stack.undo('X')).toBeNull()
      expect(stack.redo('X')).toBeNull()
      expect(stack.canUndo()).toBe(false)
      expect(stack.canRedo()).toBe(false)
    })

    it('redo restores the undone state and re-parks the current one', () => {
      const { stack } = makeStack()
      stack.push('A')
      expect(stack.undo('B')).toBe('A')
      expect(stack.redo('A')).toBe('B')
      // Round trip leaves the stacks as they started: A is undoable again.
      expect(stack.canUndo()).toBe(true)
      expect(stack.canRedo()).toBe(false)
      expect(stack.undo('B')).toBe('A')
    })

    it('walks multiple steps in order', () => {
      const { stack, tick } = makeStack()
      stack.push('A')
      tick(400)
      stack.push('B')
      tick(400)
      stack.push('C')

      expect(stack.undo('D')).toBe('C')
      expect(stack.undo('C')).toBe('B')
      expect(stack.undo('B')).toBe('A')
      expect(stack.undo('A')).toBeNull()
      // Present 'D' was parked on the redo timeline at first undo — the full
      // walk returns you to where you were, then exhausts.
      expect(stack.redo('A')).toBe('B')
      expect(stack.redo('B')).toBe('C')
      expect(stack.redo('C')).toBe('D')
      expect(stack.redo('D')).toBeNull()
    })

    it('stores snapshots by value, not by identity', () => {
      const { stack } = makeStack()
      stack.push({ v: 1 } as unknown as string)
      expect((stack.undo({} as unknown as string) as unknown as { v: number }).v).toBe(1)
    })
  })

  describe('burst coalescing', () => {
    it('folds pushes inside the coalesce window into ONE step', () => {
      const { stack, tick } = makeStack()
      tick(0)
      stack.push('S0') // gesture begins (present → S1)
      tick(100)
      stack.push('S1') // still same drag…
      tick(100)
      stack.push('S2') // …still the same drag

      // One undo lands BEFORE the whole burst, not mid-gesture.
      expect(stack.undo('S3')).toBe('S0')
      expect(stack.redo('S0')).toBe('S3')
    })

    it('a continuous long drag stays one step while gaps stay under the window', () => {
      const { stack, tick } = makeStack()
      stack.push('P0')
      for (let i = 1; i <= 10; i++) {
        tick(250) // every frame of the drag is < 300ms since the last push
        stack.push(`P${i}`)
      }
      expect(stack.undo(`P11`)).toBe('P0')
    })

    it('opens a fresh step once the gap reaches coalesceMs', () => {
      const { stack, tick } = makeStack()
      stack.push('A') // step 1
      tick(299)
      stack.push('B') // folds into step 1 (boundary: strictly-less-than)
      tick(300)
      stack.push('C') // new step

      expect(stack.undo('D')).toBe('C')
      expect(stack.undo('C')).toBe('A')
    })
  })

  describe('capacity', () => {
    it('drops the oldest entry beyond capacity', () => {
      let t = 0
      const stack = createUndoStack<string>({
        now: () => t,
        capacity: 3,
        coalesceMs: 300,
      })
      for (let i = 0; i < 5; i++) {
        stack.push(`S${i}`)
        t += 400 // every push is its own step
      }

      expect(stack.undo('X')).toBe('S4')
      expect(stack.undo('S4')).toBe('S3')
      expect(stack.undo('S3')).toBe('S2')
      expect(stack.undo('S2')).toBeNull() // S0/S1 were evicted
    })

    it('the redo side can never exceed capacity either (every future entry came from past)', () => {
      let t = 0
      const stack = createUndoStack<string>({
        now: () => t,
        capacity: 2,
        coalesceMs: 300,
      })
      stack.push('S0')
      t += 400
      stack.push('S1')
      // Only two steps exist; undo twice parks two entries, a third is null.
      expect(stack.undo('P')).toBe('S1')
      expect(stack.undo('P')).toBe('S0')
      expect(stack.undo('P')).toBeNull()
      expect(stack.canRedo()).toBe(true)

      // Walking forward again drains future without ever overflowing it.
      expect(stack.redo('Q')).toBe('P')
      expect(stack.redo('Q')).toBe('P')
      expect(stack.canRedo()).toBe(false)
    })
  })

  describe('redo invalidation', () => {
    it('a new action after undo clears the redo timeline', () => {
      const { stack, tick } = makeStack()
      stack.push('A')
      tick(400)
      stack.push('B')
      expect(stack.undo('C')).toBe('B')
      expect(stack.canRedo()).toBe(true)

      stack.push('B') // divergent action → B is gone forever
      expect(stack.canRedo()).toBe(false)
      expect(stack.redo('anything')).toBeNull()
    })

    it('clears redo even when the action folds into an open burst', () => {
      const { stack, tick } = makeStack()
      stack.push('A')
      tick(400) // close the window so this next push opens a step
      stack.push('B')
      expect(stack.undo('C')).toBe('B')
      expect(stack.canRedo()).toBe(true)

      stack.push('B') // within no window… but ANY push must kill redo
      expect(stack.canRedo()).toBe(false)
    })
  })

  describe('history navigation closes the gesture window', () => {
    it('an edit right after undo opens a NEW step (never swallowed by a stale burst)', () => {
      const { stack, tick } = makeStack()
      stack.push('A') // W1 → B   (lastPushAt = 0)
      tick(50)
      stack.undo('B') // → A      (navigation, not a push)
      stack.push('A') // W2 at t=50: must be undoable back-to-back with nothing

      expect(stack.undo('Z')).toBe('A')
    })

    it('clear() empties both stacks and resets signals', () => {
      const { stack, tick } = makeStack()
      stack.push('A')
      tick(400)
      stack.push('B')
      stack.undo('C')
      expect(stack.canUndo()).toBe(true)
      expect(stack.canRedo()).toBe(true)

      stack.clear()
      expect(stack.canUndo()).toBe(false)
      expect(stack.canRedo()).toBe(false)
      expect(stack.undo('C')).toBeNull()
      expect(stack.redo('C')).toBeNull()
    })

    it('first push after clear() opens a fresh step even within an old window', () => {
      const { stack, tick } = makeStack()
      stack.push('A')
      tick(50)
      stack.clear()
      stack.push('Q') // 50ms after the pre-clear push — must not fold away
      expect(stack.undo('R')).toBe('Q')
    })
  })
})
