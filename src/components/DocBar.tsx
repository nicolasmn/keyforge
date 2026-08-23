import { createSignal, Show } from 'solid-js'
import { doc, setDoc, replaceDoc, setSelectedLayerId } from '@/store'
import { serializeDoc, deserializeDoc, validatePersisted } from '@/utils/persistence'

/**
 * DocBar — document identity + save state + import/export.
 * Sits in the header next to playback controls.
 */
export default function DocBar() {
  const [renaming, setRenaming] = createSignal(false)
  const [importError, setImportError] = createSignal('')
  let fileInput: HTMLInputElement | undefined

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
        onClick={() => fileInput?.click()}
        title="Import a .keyforge.json file"
      >
        Import
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
    </div>
  )
}
