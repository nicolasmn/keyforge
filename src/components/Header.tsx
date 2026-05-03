import { createSignal } from 'solid-js'
import { doc, setDuration, setPlayhead, setPlaying } from '@/store'
import { exportCss } from '@/utils/export'

export default function Header() {
  // Local draft so the input isn't reactive on every keystroke
  const [draft, setDraft] = createSignal(String(doc.duration))

  function commitDuration() {
    const ms = parseInt(draft(), 10)
    if (!isNaN(ms) && ms >= 100) {
      setPlaying(false)
      // Clamp playhead so it doesn't exceed the new duration
      setPlayhead((prev) => Math.min(prev, ms))
      setDuration(ms)
    } else {
      // Revert to current value if invalid
      setDraft(String(doc.duration))
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
    if (e.key === 'Escape') {
      setDraft(String(doc.duration))
      ;(e.currentTarget as HTMLInputElement).blur()
    }
  }

  function handleExport() {
    const css = exportCss(doc)
    navigator.clipboard.writeText(css)
    alert('CSS copied to clipboard!')
  }

  return (
    <header class="app__header">
      <span class="app__logo">Keyforge</span>
      <span class="header__doc-name">{doc.name}</span>

      <label class="header__duration">
        <span class="header__duration-label">Duration</span>
        <input
          class="input header__duration-input"
          type="number"
          min="100"
          step="100"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commitDuration}
          onKeyDown={handleKeyDown}
          aria-label="Total animation duration in milliseconds"
        />
        <span class="header__duration-unit">ms</span>
      </label>

      <div class="header__actions">
        <button class="btn btn--ghost" onClick={handleExport}>
          Export CSS
        </button>
      </div>
    </header>
  )
}
