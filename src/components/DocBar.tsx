import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
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
 * DocBar — document identity + save state + grouped Import/Export menus.
 * Layout (audit F15): project cluster (switcher + New/Duplicate/Delete) |
 * name | Import ▾ (.json file / paste-CSS) | Export ▾ (JSON / CSS / CSS·RM),
 * separated by hairline dividers. Menus reuse the Inspector stack-picker
 * popover recipe with the uniform #48 contract: click toggles; outside-click,
 * focus-out and Escape close; Arrow/Home/End rove between items.
 */
export default function DocBar() {
  const [renaming, setRenaming] = createSignal(false)
  const [importError, setImportError] = createSignal('')
  const [cssModalOpen, setCssModalOpen] = createSignal(false)
  const [cssText, setCssText] = createSignal('')
  // Dropdown menu state — one open at a time (audit F15 clusters).
  const [importMenuOpen, setImportMenuOpen] = createSignal(false)
  const [exportMenuOpen, setExportMenuOpen] = createSignal(false)
  let fileInput: HTMLInputElement | undefined
  let cssDialog: HTMLDivElement | undefined
  let importCluster: HTMLDivElement | undefined
  let exportCluster: HTMLDivElement | undefined
  // Persistent Import trigger — doubles as the focus-restoration anchor for
  // both the dropdown and the paste-CSS modal opened from it (#48).
  let importTrigger: HTMLButtonElement | undefined
  let exportTrigger: HTMLButtonElement | undefined

  type MenuKind = 'import' | 'export'
  const isMenuOpen = (kind: MenuKind) => (kind === 'import' ? importMenuOpen() : exportMenuOpen())
  /** Exactly one cluster menu open at a time; null closes both. */
  function setMenu(kind: MenuKind | null) {
    setImportMenuOpen(kind === 'import')
    setExportMenuOpen(kind === 'export')
  }
  function toggleMenu(kind: MenuKind) {
    setMenu(isMenuOpen(kind) ? null : kind)
  }

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
   * back to the DocBar's Import trigger (Escape contract from #48).
   */
  function closeCssModal() {
    setCssModalOpen(false)
    importTrigger?.focus()
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

  /**
   * Run an action picked from a cluster menu: close the menu first (its DOM
   * unmounts), then hand focus back to that cluster's trigger before acting,
   * so the file picker / modal opens from a sane focus anchor (#48).
   */
  function runMenuAction(kind: MenuKind, action: () => void) {
    setMenu(null)
    ;(kind === 'import' ? importTrigger : exportTrigger)?.focus()
    action()
  }
  function importJsonFile() {
    runMenuAction('import', () => fileInput?.click())
  }
  function importFromPaste() {
    runMenuAction('import', () => setCssModalOpen(true))
  }

  // ── Uniform #48 menu contract: outside-click / focus-out / Escape close ──
  onMount(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!importMenuOpen() && !exportMenuOpen()) return
      const target = e.target as Node | null
      if (target && importCluster?.contains(target)) return
      if (target && exportCluster?.contains(target)) return
      setMenu(null)
    }
    // Fallback Escape path when focus has left the bar entirely (the per-cluster
    // handler below owns Escape while focus is inside its wrapper).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (!importMenuOpen() && !exportMenuOpen())) return
      const active = document.activeElement
      if ((importCluster?.contains(active) ?? false) || (exportCluster?.contains(active) ?? false))
        return
      setMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    })
  })

  /** Escape closes + refocuses the trigger; arrows rove across menu items. */
  function onClusterKeyDown(kind: MenuKind, e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (!isMenuOpen(kind)) return
      e.preventDefault()
      e.stopPropagation()
      setMenu(null)
      ;(kind === 'import' ? importTrigger : exportTrigger)?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const root = kind === 'import' ? importCluster : exportCluster
    const items = [...(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) return
    e.preventDefault()
    const idx = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    switch (e.key) {
      case 'ArrowDown':
        next = idx < 0 ? 0 : Math.min(idx + 1, items.length - 1)
        break
      case 'ArrowUp':
        next = idx < 0 ? items.length - 1 : Math.max(idx - 1, 0)
        break
      case 'Home':
        next = 0
        break
      default:
        next = items.length - 1
    }
    items[next].focus()
  }

  /** Close when focus leaves the cluster wrapper entirely (Tab-away contract). */
  function onClusterFocusOut(kind: MenuKind, e: FocusEvent) {
    if (!isMenuOpen(kind)) return
    const root = kind === 'import' ? importCluster : exportCluster
    const next = e.relatedTarget as Node | null
    if (!next || !root?.contains(next)) setMenu(null)
  }

  return (
    <div class="doc-bar">
      {/* Project switcher cluster (#74): pick active + lifecycle actions */}
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
      <button
        class="btn btn--ghost doc-bar__icon-btn"
        onClick={() => createProject()}
        title="New empty project"
        aria-label="New empty project"
      >
        <IconPlus />
      </button>
      <button
        class="btn btn--ghost doc-bar__icon-btn"
        onClick={() => duplicateProject(activeProjectId()!)}
        title="Duplicate this project"
        aria-label="Duplicate this project"
      >
        <IconDuplicate />
      </button>
      <button
        class="btn btn--ghost doc-bar__icon-btn"
        onClick={() => {
          const meta = listProjects().find((p) => p.id === activeProjectId())
          if (meta && confirm(`Delete project "${meta.name}"? This cannot be undone.`)) {
            deleteProject(meta.id)
          }
        }}
        title="Delete this project"
        aria-label="Delete this project"
      >
        <IconTrash />
      </button>

      <div class="doc-bar__divider" aria-hidden="true" />

      <Show
        when={!renaming()}
        fallback={
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
        }
      >
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
      </Show>

      <div class="doc-bar__divider" aria-hidden="true" />

      {/* Import cluster: ↓ into-doc arrow + menu (.json file / paste-CSS) */}
      <div
        class="doc-bar__cluster"
        ref={(el) => {
          importCluster = el
        }}
        onKeyDown={(e: KeyboardEvent) => onClusterKeyDown('import', e)}
        onFocusOut={(e) => onClusterFocusOut('import', e)}
      >
        <button
          class="btn btn--ghost doc-bar__trigger"
          ref={(el) => {
            importTrigger = el
          }}
          aria-haspopup="menu"
          aria-expanded={importMenuOpen()}
          title="Import an animation (.keyforge.json file or pasted @keyframes CSS)"
          onClick={() => toggleMenu('import')}
        >
          <IconArrowIn />
          <span>Import</span>
          <IconChevron />
        </button>
        <Show when={importMenuOpen()}>
          <div class="kf-doc-menu" role="menu" aria-label="Import options">
            <button
              class="kf-doc-menu__item"
              role="menuitem"
              title="Import a .keyforge.json file"
              onClick={importJsonFile}
            >
              <IconDoc />
              <span>JSON file…</span>
            </button>
            <button
              class="kf-doc-menu__item"
              role="menuitem"
              title="Paste @keyframes CSS and edit it here"
              onClick={importFromPaste}
            >
              <IconClipboard />
              <span>Paste CSS…</span>
            </button>
          </div>
        </Show>
      </div>

      <div class="doc-bar__divider" aria-hidden="true" />

      {/* Export cluster: ↑ out-of-doc arrow + menu (JSON / CSS / CSS·RM) */}
      <div
        class="doc-bar__cluster"
        ref={(el) => {
          exportCluster = el
        }}
        onKeyDown={(e: KeyboardEvent) => onClusterKeyDown('export', e)}
        onFocusOut={(e) => onClusterFocusOut('export', e)}
      >
        <button
          class="btn btn--ghost doc-bar__trigger"
          ref={(el) => {
            exportTrigger = el
          }}
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen()}
          title="Download the current animation (JSON, production CSS, or reduced-motion CSS)"
          onClick={() => toggleMenu('export')}
        >
          <IconArrowOut />
          <span>Export</span>
          <IconChevron />
        </button>
        <Show when={exportMenuOpen()}>
          <div class="kf-doc-menu" role="menu" aria-label="Export options">
            <button
              class="kf-doc-menu__item"
              role="menuitem"
              title="Export as JSON"
              onClick={() => runMenuAction('export', () => void exportJson())}
            >
              <span>JSON</span>
            </button>
            <button
              class="kf-doc-menu__item"
              role="menuitem"
              title="Download production CSS"
              onClick={() => runMenuAction('export', () => exportCssFile(false))}
            >
              <span>CSS</span>
            </button>
            <button
              class="kf-doc-menu__item"
              role="menuitem"
              title="Download CSS with prefers-reduced-motion fallback (opacity-only reduce variant)"
              onClick={() => runMenuAction('export', () => exportCssFile(true))}
            >
              <span>CSS·RM</span>
            </button>
          </div>
        </Show>
      </div>

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

/* ── Minimal inline SVG icons (audit F15) ────────────────────────────────
   Direction encodes in-vs-out at a glance: ↓ into-doc for Import, ↑ out-of-
   doc for Export. All decorative — visible labels/titles carry meaning. */
function IconArrowIn() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5v7m0 0L5 6.5m3 3l3-3M2.5 13.5h11"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
function IconArrowOut() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 13.5v-7m0 0L5 9.5m3-3l3 3M2.5 2.5h11"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
function IconChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
function IconPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
    </svg>
  )
}
function IconDuplicate() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="6"
        y="6"
        width="7.5"
        height="7.5"
        rx="1.25"
        stroke="currentColor"
        stroke-width="1.4"
      />
      <path
        d="M10.5 3.5H4A1.5 1.5 0 0 0 2.5 5v5.5"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  )
}
function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4h11M6 4V2.75A.75.75 0 0 1 6.75 2h2.5a.75.75 0 0 1 .75.75V4M4 4l.55 8.83A1.25 1.25 0 0 0 5.8 14h4.4a1.25 1.25 0 0 0 1.25-1.17L12 4"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
function IconDoc() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6L9 2zm0 0v4h4"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
function IconClipboard() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.5 4.5h-1A1.5 1.5 0 0 0 3 6v6.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-1"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <rect
        x="5.5"
        y="2"
        width="5"
        height="3.5"
        rx=".75"
        stroke="currentColor"
        stroke-width="1.4"
      />
    </svg>
  )
}
