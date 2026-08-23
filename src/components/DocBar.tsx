import { createSignal, Show } from 'solid-js'
import { doc, setDoc, replaceDoc, setSelectedLayerId } from '@/store'
import { serializeDoc, deserializeDoc, validatePersisted } from '@/utils/persistence'
import { parseCssToDoc } from '@/utils/cssImport'
import { exportCssReducedMotion } from '@/utils/export'
import { generateCss } from '@/utils/css'

/**
 * DocBar — document identity + save state + import/export.
 * Sits in the header next to playback controls.
 */
export default function DocBar() {
  const [renaming, setRenaming] = createSignal(false)
  const [importError, setImportError] = createSignal('')
  const [cssModalOpen, setCssModalOpen] = createSignal(false)
  const [cssText, setCssText] = createSignal('')
  const [cssWarning, setCssWarning] = createSignal('')
  let fileInput: HTMLInputElement | undefined

  function importFromCss() {
    setImportError('')
    const result = parseCssToDoc(cssText())
    if (!result.doc) {
      setCssWarning(result.warnings[0] ?? 'Could not parse this CSS.')
      return
    }
    replaceDoc(result.doc)
    setSelectedLayerId(result.doc.layers[0]?.id ?? null)
    setCssModalOpen(false)
    setCssText('')
    setCssWarning('')
  }

  function commitName() {
    setRenaming(false)
    const name = doc.name.trim()
    if (!name) setDoc('name', 'Untitled')
  }

  /** Live-update the name while typing; Enter/blur just closes the editor. */
  function onNameInput(e: Event) {
    setDoc('name', (e.currentTarget as HTMLInputElement).value)
  }

  async function exportJson() {
    const json = serializeDoc(doc)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.name.replace(/[^\w-]+/g, '_') || 'animation'}.keyforge.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  /** Download the current document as production CSS. */
  function exportCssFile(reducedMotionSafe: boolean) {
    const css = reducedMotionSafe ? exportCssReducedMotion(doc) : generateCss(doc)
    const blob = new Blob([css], { type: 'text/css' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.name.replace(/[^\w-]+/g, '_') || 'animation'}${reducedMotionSafe ? '.rm' : ''}.css`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function importFile(file: File) {
    setImportError('')
    const text = await file.text()
    // Accept both wrapped (persisted payload with version) and bare documents.
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setImportError('Not valid JSON')
      return
    }
    const isWrapped =
      typeof parsed === 'object' && parsed !== null && 'version' in (parsed as object)
    const docCandidate = isWrapped ? deserializeDoc(text) : validatePersisted(parsed)
    if (!docCandidate) {
      setImportError('Unrecognized document shape')
      return
    }
    replaceDoc(docCandidate)
    setSelectedLayerId(docCandidate.layers[0]?.id ?? null)
  }

  function onImportChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const f = input.files?.[0]
    if (f) void importFile(f)
    input.value = '' // allow re-importing the same file
  }

  return (
    <div class="doc-bar">
      <Show
        when={renaming()}
        fallback={
          <span
            class="doc-bar__name"
            tabindex={0}
            role="button"
            aria-label={`Document name: ${doc.name}. Press Enter to rename.`}
            onClick={() => setRenaming(true)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') setRenaming(true)
            }}
            title="Click to rename"
          >
            {doc.name}
          </span>
        }
      >
        <input
          class="input doc-bar__name-input"
          value={doc.name}
          aria-label="Document name"
          onInput={onNameInput}
          onBlur={commitName}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') setRenaming(false)
          }}
          autofocus
        />
      </Show>

      <button class="btn btn--ghost" onClick={exportJson} title="Export as JSON">
        Export
      </button>
      <button
        class="btn btn--ghost"
        onClick={() => exportCssFile(false)}
        title="Download production CSS"
      >
        CSS
      </button>
      <button
        class="btn btn--ghost"
        onClick={() => exportCssFile(true)}
        title="Download CSS with prefers-reduced-motion fallback (opacity-only reduce variant)"
      >
        CSS·RM
      </button>
      <button
        class="btn btn--ghost"
        onClick={() => fileInput?.click()}
        title="Import a .keyforge.json file"
      >
        Import
      </button>
      <button
        class="btn btn--ghost"
        onClick={() => {
          setCssWarning('')
          setCssModalOpen(true)
        }}
        title="Paste @keyframes CSS and edit it here"
      >
        From CSS…
      </button>
      <input
        ref={(el) => {
          fileInput = el
        }}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={onImportChange}
      />
      <Show when={importError()}>
        <span class="doc-bar__error" role="alert">
          {importError()}
        </span>
      </Show>

      {/* CSS paste-import modal */}
      <Show when={cssModalOpen()}>
        <div
          class="css-import__backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCssModalOpen(false)
          }}
        >
          <div class="css-import" role="dialog" aria-label="Import CSS keyframes">
            <div class="css-import__head">
              <strong>Paste @keyframes CSS</strong>
              <button
                class="btn btn--ghost css-import__close"
                aria-label="Close import dialog"
                onClick={() => setCssModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <textarea
              class="input css-import__textarea"
              placeholder={
                '@keyframes pulse {\n  0%   { opacity: 0; }\n  100% { opacity: 1; }\n}\n\nanimation-duration: 2s;'
              }
              value={cssText()}
              onInput={(e) => setCssText((e.currentTarget as HTMLTextAreaElement).value)}
              spellcheck={false}
              rows={12}
            />
            <Show when={cssWarning()}>
              <p class="css-import__warning" role="alert">
                {cssWarning()}
              </p>
            </Show>
            <div class="css-import__actions">
              <button class="btn btn--ghost" onClick={() => setCssModalOpen(false)}>
                Cancel
              </button>
              <button class="btn btn--primary" onClick={importFromCss} disabled={!cssText().trim()}>
                Import animation
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
