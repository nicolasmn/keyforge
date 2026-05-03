import { doc } from '@/store'
import { exportCss } from '@/utils/export'

export default function Header() {
  function handleExport() {
    const css = exportCss(doc)
    navigator.clipboard.writeText(css)
    alert('CSS copied to clipboard!')
  }

  return (
    <header class="app__header">
      <span class="app__logo">Keyforge</span>
      <span class="header__doc-name">{doc.name}</span>
      <div class="header__actions">
        <button class="btn btn--ghost" onClick={handleExport}>
          Export CSS
        </button>
      </div>
    </header>
  )
}
