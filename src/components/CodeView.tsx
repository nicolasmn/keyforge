/**
 * CodeView — the CSS panel as an ALWAYS-ON live editor (owner decision,
 * 2026-08-24: "always show full css, editable right away").
 *
 * There is no edit-mode gate anymore: no Edit/Done/Cancel buttons, no
 * scope toggle, no enterEdit(). A CodeMirror 6 editor seeded with the
 * canonical full-document CSS is mounted on first render and stays put.
 *
 * Sync rules (the heart of the model — see plan §3/§7 caret contract):
 *   - CLEAN (editor content === last-synced canonical): external store
 *     changes flow INTO the editor via a whole-doc dispatch; the buffer
 *     tracks the document at all times.
 *   - DIRTY (user typed since last commit/reload): freeze — external store
 *     changes never rewrite the buffer; they surface only through the
 *     "Document changed outside editor" chip + Reload button.
 *   - APPLY (button / Ctrl+Cmd+Enter): commitEditedCss() enrichment →
 *     replaceDoc() → selection-by-name restore → keyframe selection cleared
 *     → pause → playhead clamp — unchanged from Phase A. Afterwards the
 *     editor resyncs to the post-commit canonical output (caret to 0 — an
 *     explicit apply makes that acceptable) and flashes "Saved ✓".
 *   - RELOAD: resync from canonical, clearing dirty + chip.
 *
 * A 400ms-debounced parse remains STATUS-ONLY: it drives the aria-live
 * status line and Apply enablement, never the document. Typing never
 * touches the store, so autosave churn stays zero between commits.
 *
 * CM6 is dynamically imported inside onMount so this panel's chunk stays
 * out of the main bundle (same lazy pattern Inspector already uses to load
 * CodeView itself). While it loads — or if its chunk ever fails — a plain
 * textarea fallback keeps the panel usable and editable.
 */

import { createSignal, createMemo, createEffect, onCleanup, onMount, untrack, Show } from 'solid-js'
import {
  doc,
  theme,
  getSelectedLayer,
  replaceDoc,
  setSelectedLayerId,
  setSelectedKeyframeId,
  playhead,
  setPlayhead,
  setPlaying,
} from '@/store'
import type { ThemeName } from '@/utils/persistence'
import { parseCssToDoc } from '@/utils/cssImport'
import {
  buildEditableSnapshot,
  clampPlayhead,
  commitEditedCss,
  preserveSelectionByName,
  snapshotExclusionReason,
  unrepresentableLayers,
} from '@/utils/cssEdit'

// Type-only imports: erased at build time, keep the runtime import dynamic.
import type { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/** Live-parse debounce while typing (plan §3.3). Parsing itself is cheap. */
const LIVE_PARSE_DEBOUNCE_MS = 400
const SAVED_FLASH_MS = 1600

/* ── App-token plumbing for the CM theme ──────────────────────────────── */

interface PanelTokens {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  muted: string
  accent: string
  accentDim: string
  mono: string
  fontSize: string
}

/** Syntax colors complementing the app palette (hand-tuned per mode). */
const SYNTAX_VALUE_COLOR = { dark: '#7dd3fc', light: '#0369a1' }

function readPanelTokens(): PanelTokens & { isDark: boolean } {
  const cs = getComputedStyle(document.documentElement)
  const tok = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    bg: tok('--color-bg', '#101318'),
    surface: tok('--color-surface', '#1c1e25'),
    surface2: tok('--color-surface-2', '#26282f'),
    border: tok('--color-border', '#33353d'),
    text: tok('--color-text', '#dcdee3'),
    muted: tok('--color-text-muted', '#787d8c'),
    accent: tok('--color-accent', '#a78bfa'),
    accentDim: tok('--color-accent-dim', '#4c3a7d'),
    mono: tok('--font-mono', 'ui-monospace, monospace'),
    fontSize: tok('--font-size-xs', '11px'),
    isDark: document.documentElement.dataset.theme !== 'light',
  }
}

export default function CodeView() {
  const [copied, setCopied] = createSignal(false)
  /** True once the CM EditorView is created and mounted. */
  const [editorReady, setEditorReady] = createSignal(false)
  /** True when the dynamic CM import itself failed → textarea fallback. */
  const [cmFailed, setCmFailed] = createSignal(false)

  // ── Editing state machine (plan §3), now permanently engaged ───────────
  /** Mirror of the editor buffer; updated by CM's update listener. */
  const [draft, setDraft] = createSignal('')
  /** Text as of the last commit/reload/external sync — dirty = draft differs. */
  const [committedText, setCommittedText] = createSignal('')
  /**
   * Canonical output the editor last synced with. Kept SEPARATE from
   * committedText on purpose: after a commit with non-canonical user
   * formatting, committedText === draft but canonical output differs —
   * that must NOT flag an external change or rewrite.
   */
  const [syncedCanonical, setSyncedCanonical] = createSignal('')
  const [savedFlash, setSavedFlash] = createSignal(false)
  const [debouncedDraft, setDebouncedDraft] = createSignal('')

  const isDirty = () => draft() !== committedText()
  /** Store changed underneath us beyond our last sync point → offer Reload. */
  const externalChanged = () => syncedCanonical() !== canonicalCss()

  // Canonical full-doc CSS — recomputed on every store change.
  const canonicalCss = createMemo(() => buildEditableSnapshot(doc))

  /* ── CM instance plumbing ────────────────────────────────────────────── */
  let host!: HTMLDivElement
  let view: EditorView | null = null
  /** Guards the async mount: a tab switch can dispose THIS instance while
   *  its CM chunk imports are still in flight — a stale continuation must
   *  not create a view into a detached host (that orphaned the editor). */
  let disposed = false
  let applyCmTheme: ((t: ThemeName) => void) | null = null
  let savedTimer: ReturnType<typeof setTimeout> | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleStatusParse(text: string) {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => setDebouncedDraft(text), LIVE_PARSE_DEBOUNCE_MS)
  }
  onCleanup(() => clearTimeout(debounceTimer))
  onCleanup(() => {
    clearTimeout(savedTimer)
    disposed = true
    view?.destroy()
    view = null
  })
  onCleanup(() => view?.destroy())

  /**
   * Resync the editor to `text` (canonical): whole-doc dispatch per the
   * sync rules, signals updated, status parse refreshed instantly (no
   * debounce wait — mirrors the old enterEdit seeding).
   */
  function resyncEditor(text: string) {
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 }, // caret reset acceptable on explicit sync points
        scrollIntoView: true,
      })
    }
    setDraft(text)
    setCommittedText(text)
    setSyncedCanonical(text)
    clearTimeout(debounceTimer)
    setDebouncedDraft(text)
  }

  /** Chip's Reload — discard local state, take canonical. */
  function reloadFromCanonical() {
    resyncEditor(canonicalCss())
  }

  /* ── Status-only debounced parse (plan §3.3) ────────────────────────── */

  /** Mirrors DocBar's live-parse memo; drives status + Apply enablement ONLY. */
  const liveParse = createMemo(() => {
    const text = debouncedDraft().trim()
    return text ? parseCssToDoc(text) : null
  })
  const canApply = () => !!liveParse()?.doc

  interface EditorStatus {
    kind: 'fatal' | 'warn' | 'ok'
    text: string
    title?: string
  }

  const status = createMemo<EditorStatus | null>(() => {
    if (savedFlash()) return { kind: 'ok', text: 'Saved ✓' }
    const result = liveParse()
    if (!result) return null // empty buffer — nothing to report yet
    if (!result.doc) {
      return {
        kind: 'fatal',
        text: `Could not parse this CSS. ${result.warnings[0] ?? ''}`.trim(),
        title: result.warnings.join('\n'),
      }
    }
    if (result.warnings.length > 0) {
      const shown = result.warnings.slice(0, 3)
      const extra = result.warnings.length - shown.length
      return {
        kind: 'warn',
        text: shown.join(' '),
        title: result.warnings.join('\n') + (extra > 0 ? `\n+${extra} more` : ''),
      }
    }
    const d = result.doc
    return {
      kind: 'ok',
      text: `Ready · ${d.layers.length} ${d.layers.length === 1 ? 'layer' : 'layers'} · ${d.duration}ms`,
    }
  })

  /** R1 transparency: layers absent from the editable text, kept on commit. */
  const excludedNotice = () => {
    const layers = unrepresentableLayers(doc)
    if (layers.length === 0) return ''
    const parts = layers.map((l) => {
      const reason = snapshotExclusionReason(l)
      return `"${l.name}" ${reason === 'hidden' ? 'is hidden' : 'has no keyframes yet'}`
    })
    return `Not in the editable text (kept untouched on commit): ${parts.join(', ')}.`
  }

  // ── Actions ────────────────────────────────────────────────────────────

  function flashSaved() {
    clearTimeout(savedTimer)
    setSavedFlash(true)
    savedTimer = setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS)
  }

  /**
   * Commit path (unchanged from Phase A): enrich → replaceDoc → re-select
   * by name → clear keyframe selection → pause → clamp playhead. Then one
   * deliberate deviation from the textarea era, per owner spec: the editor
   * RESYNCS to post-commit canonical output (caret to 0) instead of keeping
   * raw user formatting, so the buffer always reflects the real document.
   */
  function applyCommit(): boolean {
    const result = commitEditedCss(draft(), doc)
    if (!result.nextDoc) return false
    // Capture identity BEFORE replaceDoc reconciles every id away.
    const selectedName = getSelectedLayer()?.name ?? null
    replaceDoc(result.nextDoc) // single immediate autosave flush (store behavior)
    setSelectedLayerId(
      preserveSelectionByName(selectedName, result.nextDoc) ?? result.nextDoc.layers[0]?.id ?? null,
    )
    setSelectedKeyframeId(null)
    setPlaying(false)
    setPlayhead(clampPlayhead(playhead(), result.nextDoc.duration))
    flashSaved()
    untrack(() => resyncEditor(canonicalCss())) // our own commit is not an external change
    return true
  }

  function handleCopy() {
    navigator.clipboard.writeText(draft()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // Seed immediately (before CM loads) so Copy + status work during loading.
  untrack(() => {
    const snap = canonicalCss()
    setDraft(snap)
    setCommittedText(snap)
    setSyncedCanonical(snap)
    setDebouncedDraft(snap) // instant status on mount, no debounce wait
  })

  // ── Store → editor flow (sync rules) ──────────────────────────────────
  // CLEAN: external changes flow INTO the editor. DIRTY: frozen — the chip
  // handles it. Re-runs are cheap (guard exits); also covers the ready flip.
  createEffect(() => {
    const canonical = canonicalCss() // tracked: store output
    const ready = editorReady() // tracked: re-check once CM mounts
    const dirty = isDirty() // tracked: typing flips this constantly
    if (!ready || dirty) return
    if (view && view.state.doc.toString() === canonical) return
    untrack(() => resyncEditor(canonical))
  })

  // Theme flip → re-read tokens, reconfigure the theme compartment.
  // toggleTheme updates <html data-theme> synchronously before effects
  // flush, so getComputedStyle here already sees the new palette.
  createEffect(() => {
    const t = theme()
    untrack(() => applyCmTheme?.(t))
  })

  onMount(async () => {
    try {
      // All five modules land in one lazy chunk together.
      const [
        { EditorState, Compartment, Prec },
        {
          EditorView,
          keymap,
          lineNumbers,
          highlightActiveLine,
          highlightActiveLineGutter,
          drawSelection,
        },
        { css },
        { history, defaultKeymap, historyKeymap, indentWithTab },
        { HighlightStyle, syntaxHighlighting },
        { tags },
      ] = await Promise.all([
        import('@codemirror/state'),
        import('@codemirror/view'),
        import('@codemirror/lang-css'),
        import('@codemirror/commands'),
        import('@codemirror/language'),
        import('@lezer/highlight'),
      ])
      if (disposed || !host.isConnected) return // superseded by a remount mid-await

      const themeCompartment = new Compartment()

      const makeThemeExt = (): Extension[] => {
        const tk = readPanelTokens()
        const valueColor = tk.isDark ? SYNTAX_VALUE_COLOR.dark : SYNTAX_VALUE_COLOR.light
        const highlight = HighlightStyle.define([
          { tag: tags.comment, color: tk.muted, fontStyle: 'italic' },
          { tag: tags.keyword, color: tk.accent }, // @keyframes/@media/from/to
          { tag: [tags.tagName, tags.className], color: tk.accent }, // selectors
          { tag: tags.propertyName, color: tk.text }, // declarations
          {
            tag: [tags.number, tags.unit, tags.string, tags.color, tags.variableName],
            color: valueColor,
          },
        ])
        return [
          syntaxHighlighting(highlight),
          EditorView.theme({
            '&': {
              height: '100%',
              fontSize: tk.fontSize,
              color: tk.text,
              backgroundColor: tk.bg,
            },
            '.cm-scroller': {
              fontFamily: tk.mono,
              lineHeight: '1.6',
              overflow: 'auto',
            },
            '.cm-content': {
              caretColor: tk.accent,
              padding: '12px 0',
            },
            '&.cm-focused': { outline: `2px solid ${tk.accent}` }, // app input focus convention
            '&.cm-focused .cm-selectionLayer .cm-selectionBackground, & .cm-selectionLayer .cm-selectionBackground':
              { backgroundColor: tk.accentDim },
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: tk.accent },
            '.cm-gutters': {
              backgroundColor: tk.surface,
              color: tk.muted,
              borderRight: `1px solid ${tk.border}`,
            },
            '.cm-activeLine': { backgroundColor: tk.surface2 },
            '.cm-activeLineGutter': { backgroundColor: tk.surface2 },
          }),
        ]
      }

      const updateListener = EditorView.updateListener.of((u) => {
        if (!u.docChanged) return
        const text = u.state.doc.toString()
        setDraft(text)
        scheduleStatusParse(text)
      })

      const state = EditorState.create({
        doc: draft(),
        extensions: [
          css(), // the CSS language: parser + syntax tree for highlighting
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          updateListener,
          // Apply beats everything on Mod-Enter; standard editing keys after.
          Prec.high(
            keymap.of([
              { key: 'Mod-Enter', preventDefault: true, run: () => (applyCommit(), true) },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          themeCompartment.of(makeThemeExt()),
          EditorState.allowMultipleSelections.of(true),
        ],
      })

      // imports resolved
      console.log(
        '[cm] imports ok, creating view into host:',
        host.className,
        'connected:',
        host.isConnected,
      )
      view = new EditorView({ state, parent: host })
      // view created
      applyCmTheme = (t: ThemeName) => {
        void t // palette comes from CSS custom properties, re-read below
        view?.dispatch({ effects: themeCompartment.reconfigure(makeThemeExt()) })
      }
      setEditorReady(true)
      // Focus for fine pointers only — avoid force-popping mobile keyboards.
      if (window.matchMedia?.('(pointer: fine)').matches) queueMicrotask(() => view?.focus())
    } catch {
      // Chunk failed (stale deploy cache etc.) — textarea fallback stays usable.
      setCmFailed(true)
    }
  })

  return (
    <div class="code-view">
      <div class="code-view__toolbar">
        <span
          class="code-view__title"
          title="Full-document CSS — edits apply to the whole document"
        >
          CSS · full document
        </span>
        <div class="code-view__actions">
          <Show when={!editorReady() && !cmFailed()}>
            <span class="code-view__loading">Loading editor…</span>
          </Show>
          <button
            class="btn btn--primary code-view__btn"
            onClick={applyCommit}
            disabled={!canApply()}
            title="Apply changes to the document (Ctrl/Cmd+Enter)"
          >
            Apply
          </button>
          <button
            class="btn btn--ghost code-view__copy-btn"
            onClick={handleCopy}
            title="Copy the current editor text"
          >
            {copied() ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Persistent polite live region under the toolbar (DocBar pattern):
          parse problems are announced without stealing focus, never a modal. */}
      <div class="code-view__statusbar">
        <Show when={excludedNotice()}>
          <p class="code-view__notice">{excludedNotice()}</p>
        </Show>
        <Show when={externalChanged()}>
          <span class="code-view__chip">
            Document changed outside editor
            <button class="btn btn--ghost code-view__chip-btn" onClick={reloadFromCanonical}>
              Reload
            </button>
          </span>
        </Show>
        <p
          class={`code-view__status code-view__status--${status()?.kind ?? 'ok'}`}
          role="status"
          aria-live="polite"
          title={status()?.title || undefined}
        >
          {status()?.text ?? ''}
        </p>
      </div>

      {/* Editor host is STRUCTURALLY PERMANENT — Solid never adds/removes or
          replaces this node across loading/failure states, so the CodeMirror
          instance bound to it on mount can never be orphaned. States are
          overlays (hidden attribute), not conditional siblings. */}
      <div
        class="code-view__editor"
        classList={{ 'code-view__editor--loading': !editorReady() }}
        ref={(el) => (host = el)}
        aria-label="CSS editor"
        aria-busy={!editorReady()}
      >
        <div class="code-view__loading-pane" hidden={cmFailed() || editorReady()}>
          Loading editor…
        </div>
        <Show when={cmFailed()}>
          <textarea
            class="input code-view__textarea"
            value={draft()}
            aria-label="CSS editor (fallback)"
            spellcheck={false}
            onInput={(e) => {
              const text = e.currentTarget.value
              setDraft(text)
              scheduleStatusParse(text)
            }}
            onKeyDown={(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                applyCommit()
              }
            }}
          />
        </Show>
      </div>
    </div>
  )
}
