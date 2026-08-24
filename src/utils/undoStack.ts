import { createSignal } from 'solid-js'

/**
 * Snapshot-based undo/redo stack for the KeyForge document store.
 *
 * Pure-ish: no dependency on the store or persistence — callers hand it
 * opaque snapshots (the store passes `serializeDoc(doc)` strings). Solid
 * signals are used only so UI can bind `canUndo()` / `canRedo()` directly.
 *
 * ── Shape ──────────────────────────────────────────────────────────────
 * Two stacks. `past` holds snapshots strictly OLDER than the present
 * ("what undo lands on"); `future` holds states undone away ("what redo
 * restores"). The caller owns the present — it is never stored here; the
 * `undo(current)` / `redo(current)` signatures take it as an argument.
 *
 *   push(A)  [user action → present becomes B]   past=[A]
 *   undo(B)  → returns A, future=[B], past=[]
 *   redo(A)  → returns B, past=[A], future=[]
 *
 * ── Burst coalescing ───────────────────────────────────────────────────
 * Drags/scrubs fire dozens of committed writes per gesture; each one must
 * NOT become its own undo step. Rule: if the previous push() call was less
 * than `coalesceMs` ago, the top of `past` already holds the pre-burst
 * state, so the incoming snapshot is folded into that step instead of
 * appended (the burst timer refreshes — a continuous drag stays ONE step
 * until ~300ms of quiet). A fresh step is only opened once the gap since
 * the last push reaches `coalesceMs`.
 *
 * Note on wording vs. mechanics: this "fold into the existing step" rule
 * is what the agreed design calls "replace instead of append". Mechanically
 * folding is REQUIRED here rather than literally overwriting the top
 * entry: push() receives each write's PREVIOUS state, and overwriting the
 * top (which holds the state before the whole burst) would strand the
 * pre-burst state — an undo would land mid-gesture instead of before it.
 * Folding keeps exactly the intended user-visible behavior: bursts collapse
 * to a single undo step.
 *
 * Any push() also clears `future` unconditionally — a new action invalidates
 * the redo timeline even if the push itself folds into an open step.
 */
export interface UndoStackOptions {
  /** Injectable clock (ms). Defaults to Date.now — override in tests. */
  now?: () => number
  /** Maximum retained entries per direction. Oldest dropped beyond this. */
  capacity?: number
  /** Gap under which consecutive pushes count as one gesture (ms). */
  coalesceMs?: number
}

const DEFAULT_CAPACITY = 50
const DEFAULT_COALESCE_MS = 300

export function createUndoStack<T>(options: UndoStackOptions = {}) {
  const now = options.now ?? Date.now
  const capacity = options.capacity ?? DEFAULT_CAPACITY
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS

  let past: T[] = []
  let future: T[] = []
  // Timestamp of the last push() CALL (appended or folded). -Infinity =
  // "no open gesture", so the first-ever push always opens a fresh step.
  let lastPushAt = Number.NEGATIVE_INFINITY

  const [canUndo, setCanUndo] = createSignal(false)
  const [canRedo, setCanRedo] = createSignal(false)

  function emit(): void {
    setCanUndo(past.length > 0)
    setCanRedo(future.length > 0)
  }

  /**
   * Record the state from BEFORE a committed mutation (the new present is
   * the caller's business). Folds into the open step when pushes arrive in
   * a rapid burst; otherwise appends a fresh step (dropping the oldest when
   * over capacity) and invalidates any pending redo entries.
   */
  function push(snapshot: T): void {
    future.length = 0 // a new action always kills the redo timeline

    const t = now()
    if (past.length > 0 && t - lastPushAt < coalesceMs) {
      // Burst continues: `past`'s top already holds the pre-burst snapshot,
      // so fold this write into the same undo step by refreshing the timer.
      lastPushAt = t
      emit()
      return
    }
    past.push(snapshot)
    while (past.length > capacity) past.shift()
    lastPushAt = t
    emit()
  }

  /**
   * Move back one step: pops the oldest-adjacent snapshot off `past` to be
   * restored, and records the CURRENT state (`current`) onto `future`.
   * Returns null when there is nothing to undo. Not part of burst timing —
   * history navigation closes any open gesture window.
   */
  function undo(current: T): T | null {
    const target = moveTop(past, future, current)
    return target
  }

  /** Symmetric to undo(): pull a state back out of `future`. */
  function redo(current: T): T | null {
    return moveTop(future, past, current)
  }

  function moveTop(from: T[], to: T[], current: T): T | null {
    const target = from.pop()
    if (target === undefined) return null
    to.push(current)
    while (to.length > capacity) to.shift()
    lastPushAt = Number.NEGATIVE_INFINITY
    emit()
    return target
  }

  /** Drop all history (e.g. document switch — timelines are per-document). */
  function clear(): void {
    past = []
    future = []
    lastPushAt = Number.NEGATIVE_INFINITY
    emit()
  }

  return { push, undo, redo, clear, canUndo, canRedo }
}
