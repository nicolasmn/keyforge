import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  doc,
  setDoc,
  replaceDoc,
  setSelectedLayerId,
  listProjects,
  activeProjectId,
  openProject,
  createProject,
  duplicateProject,
  deleteProject,
  renameProject,
} from '@/store'
import { serializeDoc, deserializeDoc, validatePersisted } from '@/utils/persistence'
import { parseCssToDoc } from '@/utils/cssImport'
import { exportCssReducedMotion } from '@/utils/export'
import { generateCss } from '@/utils/css'
import ThemeToggle from '@/components/ThemeToggle'

/**
 * DocBar — document identity + save state + import/export.
 * Sits in the header next to playback controls.
 */
export default function DocBar() {
  const [renaming, setRenaming] = createSignal(false)
  const [importError, setImportError] = createSignal('')
  const [cssModalOpen, setCssModalOpen] = createSignal(false)
  const [cssText, setCssText] = createSignal('')
  let fileInput: HTMLInputElement | undefined
  let cssImportTrigger: HTMLButtonElement | undefined
  let cssDialog: HTMLDivElement | undefined

  /** Live parse of the pasted CSS — drives Import enablement and the inline warning. */
  const cssParse = createMemo(() => {
    const text = cssText().trim()
    return text ? parseCssToDoc(text) : null
  })
  /** Import stays disabled until the textarea parses into at least one layer (audit F13). */
  const canImportCss = () => !!cssParse()?.doc
  /** First failure reason for the current text; '' when empty or parseable. */
  const cssParseWarning = () => {
    const result = cssParse()
    if (!result || result.doc) return ''
    return result.warnings[0] ?? 'Could not parse this CSS.'
  }

  /**
   * Uniform close path for the paste-CSS modal: dismisses it and hands focus
   * back to the "From CSS…" trigger (Escape contract from #48).
   */
  function closeCssModal() {
    setCssModalOpen(false)
    cssImportTrigger?.focus()
  }

  /**
   * Modal keyboard contract: Escape closes (restoring focus via closeCssModal),
   * Tab/Shift+Tab cycle inside the dialog so keyboard users can't reach the page.
   */
  function onCssModalKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeCssModal()
      return
    }
    if (e.key !== 'Tab' || !cssDialog) return
    const focusable = cssDialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !cssDialog.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function importFromCss() {
    setImportError('')
    const result = cssParse()
    // Defensive only — the button is disabled unless the parse yields a doc.
    if (!result?.doc) return
    setCssText('')
    replaceDoc(result.doc)
    setSelectedLayerId(result.doc.layers[0]?.id ?? null)
    closeCssModal()
  }

  function commitName() {
    setRenaming(false)
    // Route through the project registry so the index and the live document
    // stay in lockstep (renameProject also uniquifies against siblings).
    renameProject(activeProjectId()!, doc.name.trim() || 'Untitled')
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

      {/* Project switcher (plan §5): pick active + lifecycle actions */}
      <select
        class="input doc-bar__switcher"
        value={activeProjectId() ?? ''}
        aria-label="Active project"
        onChange={(e) => {
          void openProject((e.currentTarget as HTMLSelectElement).value)
        }}
      >
        <For each={listProjects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
      </select>
      <button class="btn btn--ghost" onClick={() => createProject()} title="New empty project">
        + New
      </button>
      <button
        class="btn btn--ghost"
        onClick={() => duplicateProject(activeProjectId()!)}
        title="Duplicate this project"
      >
        Duplicate
      </button>
      <button
        class="btn btn--ghost"
        onClick={() => {
          const meta = listProjects().find((p) => p.id === activeProjectId())
          if (meta && confirm(`Delete project "${meta.name}"? This cannot be undone.`)) {
            deleteProject(meta.id)
          }
        }}
        title="Delete this project"
      >
        Delete
      </button>

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
        ref={(el) => {
          cssImportTrigger = el
        }}
        onClick={() => {
          setCssModalOpen(true)
        }}
        title="Paste @keyframes CSS and edit it here"
      >
        From CSS…
      </button>
      {/* App-global chrome at the right end of the ghost-button row —
          same component as the mobile bar's second mount (ThemeToggle). */}
      <ThemeToggle />
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
        {/* title keeps the full message reachable when the bar clips it (audit F13). */}
        <span class="doc-bar__error" role="alert" title={importError()}>
          {importError()}
        </span>
      </Show>

      {/* CSS paste-import modal */}
      <Show when={cssModalOpen()}>
        <div
          class="css-import__backdrop"
          onKeyDown={onCssModalKeyDown}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCssModal()
          }}
        >
          <div
            class="css-import"
            role="dialog"
            aria-modal="true"
            aria-label="Import CSS keyframes"
            ref={(el) => {
              cssDialog = el
            }}
          >
            <div class="css-import__head">
              <strong>Paste @keyframes CSS</strong>
              <button
                class="btn btn--ghost css-import__close"
                aria-label="Close import dialog"
                onClick={() => closeCssModal()}
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
              ref={(el) => {
                // Autofocus on open — refs re-run on every <Show> mount.
                queueMicrotask(() => el.focus())
              }}
            />
            <div class="css-import__actions">
              {/* Persistent polite live region next to the action row, so parse
                  problems are announced and never hidden below the textarea. */}
              <p class="css-import__warning" aria-live="polite">
                {cssParseWarning()}
              </p>
              <button class="btn btn--ghost" onClick={() => closeCssModal()}>
                Cancel
              </button>
              <button class="btn btn--primary" onClick={importFromCss} disabled={!canImportCss()}>
                Import animation
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
