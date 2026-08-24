import { playing, setPlaying, playhead, setPlayhead, doc, undo, redo } from '@/store'

/**
 * Toggle playback exactly like the play/pause button: pause while playing,
 * otherwise start from the head if the playhead has reached (or passed) the end.
 */
export function togglePlayback(): void {
  if (playing()) {
    setPlaying(false)
  } else {
    if (playhead() >= doc.duration) setPlayhead(0)
    setPlaying(true)
  }
}

/**
 * True when the event target is a text-entry surface where Space must keep
 * its native meaning (typing a space) instead of toggling playback — and
 * where Cmd/Ctrl+Z must keep the text surface's own undo history.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  )
}

/**
 * Global keyboard shortcuts (audit F22): Space = play/pause.
 *
 * Undo shortcuts (document-only scope): Cmd/Ctrl+Z = undo,
 * Cmd/Ctrl+Shift+Z or Ctrl+Y = redo.
 *
 * Guarded so typing surfaces keep their native behavior (Space types a
 * space; Cmd/Ctrl+Z drives the editor's own undo stack, including
 * CodeMirror's in the CSS view), and focused buttons keep native activation
 * (Space on a button clicks it — intercepting it here would double-toggle
 * or swallow the click).
 *
 * Returns a cleanup function that removes the listener.
 */
export function installGlobalShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      if (isTypingTarget(e.target as EventTarget | null)) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    // Ctrl+Y: classic Windows/Linux redo alias (Cmd+Y is browser History on
    // macOS, so it stays unclaimed there — Shift+Z covers mac redo).
    if (mod && !e.metaKey && (e.key === 'y' || e.key === 'Y')) {
      if (isTypingTarget(e.target as EventTarget | null)) return
      e.preventDefault()
      redo()
      return
    }
    if (e.code !== 'Space') return
    const target = e.target as HTMLElement | null
    if (isTypingTarget(target)) return
    if (target && target.tagName === 'BUTTON') return
    e.preventDefault()
    togglePlayback()
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
