import { createSignal } from 'solid-js'
import { doc, setDuration, setPlayhead, setPlaying } from '@/store'

export default function Header() {
  const [draft, setDraft] = createSignal(String(doc.duration))

  function commitDuration() {
    const ms = parseInt(draft(), 10)
    if (!isNaN(ms) && ms >= 100) {
      setPlaying(false)
      setPlayhead((prev) => Math.min(prev, ms))
      setDuration(ms)
    } else {
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
    </header>
  )
}
