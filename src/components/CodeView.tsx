/**
 * CodeView — CSS output panel and, since Phase A of the CSS-live-editing
 * plan (docs/plans/2026-08-24-css-live-editing.md), a live editing region.
 *
 * Read-only mode renders generateCss() output for either:
 *   - the selected layer only (default)
 *   - the full document (toggle)
 *
 * Edit mode (full-doc scope only) swaps the highlighted view for a plain
 * <textarea> seeded ONCE from a snapshot of the generated CSS. The draft is
 * the single source of truth for the textarea while editing: store changes
 * never rewrite it (dirty-freeze), external changes surface as a chip with
 * an explicit Reload instead. A 400ms-debounced parse is STATUS-ONLY — it
 * drives the aria-live status line and Apply/Done enablement, never the
 * document. Commit runs commitEditedCss() (enrichment pass) → replaceDoc(),
 * then re-selects the layer by name, clears the stale keyframe selection,
 * pauses playback and clamps the playhead. After a commit the textarea is
 * NOT rewritten from canonical output — the user's formatting stays put.
 *
 * Syntax highlighting via Shiki (loaded from CDN, async) in read-only mode
 * only; plain <pre> fallback when Shiki hasn't loaded or fails.
 */
import { createSignal, createMemo, createEffect, onCleanup, onMount, untrack, Show } from 'solid-js'
import {
  doc,
  getSelectedLayer,
  replaceDoc,
  setSelectedLayerId,
  setSelectedKeyframeId,
  playhead,
  setPlayhead,
  setPlaying,
} from '@/store'
import { generateLayerCss } from '@/utils/css'
import { parseCssToDoc } from '@/utils/cssImport'
import {
  buildEditableSnapshot,
  clampPlayhead,
  commitEditedCss,
  preserveSelectionByName,
  snapshotExclusionReason,
  unrepresentableLayers,
} from '@/utils/cssEdit'

/** Live-parse debounce while typing (plan §3.3). Parsing itself is cheap. */
const LIVE_PARSE_DEBOUNCE_MS = 400
const SAVED_FLASH_MS = 1600

// Shiki is loaded once, lazily, on first render.
let highlighter: { codeToHtml: (code: string, opts: object) => string } | null = null
let shikiReady = false

async function loadShiki() {
  if (shikiReady) return
  try {
    // esm.sh CDN — no ambient type declarations; ignore the unresolvable module error.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { createHighlighter } = await import('https://esm.sh/shiki@1?bundle=true')
    highlighter = await createHighlighter({
      themes: ['dark-plus'],
      langs: ['css'],
    })
    shikiReady = true
  } catch {
    // Shiki unavailable (offline / CDN blocked) — plain text fallback stays active
  }
}

async function highlight(code: string): Promise<string | null> {
  if (!shikiReady) await loadShiki()
  if (!highlighter) return null
  return highlighter.codeToHtml(code, { lang: 'css', theme: 'dark-plus' })
}

export default function CodeView() {
  const [showAll, setShowAll] = createSignal(false)
  const [highlighted, setHighlighted] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)

  // ── Editing state machine (plan §3) ────────────────────────────────────
  const [editing, setEditing] = createSignal(false)
  /** Source of truth for the textarea between seed and commit/cancel. */
  const [draft, setDraft] = createSignal('')
  /** Text as of the last seed/commit — dirty means "unapplied edits exist". */
  const [committedText, setCommittedText] = createSignal('')
  /**
   * Canonical output the editor last synced with (seed / reload / commit).
   * Kept SEPARATE from committedText on purpose: after a commit with
   * non-canonical user formatting, committedText === draft but canonical
   * output differs — that must NOT flag an external change or rewrite.
   */
  const [syncedCanonical, setSyncedCanonical] = createSignal('')
  const [savedFlash, setSavedFlash] = createSignal(false)
  const [debouncedDraft, setDebouncedDraft] = createSignal('')

  const isDirty = () => editing() && draft() !== committedText()
  /** Store changed underneath the open editor → offer Reload, never auto-rewrite. */
  const externalChanged = () => editing() && syncedCanonical() !== buildEditableSnapshot(doc)

  // Canonical full-doc CSS — recomputed on every store change.
  const canonicalCss = createMemo(() => buildEditableSnapshot(doc))

  // Raw CSS string shown/copied:
  //   read-only → canonical output or per-layer output;
  //   editing   → the DRAFT. Pinned decision (plan §7 QA): Copy copies what
  //               you see — the draft — while editing.
  const rawCss = createMemo(() => {
    if (editing()) return draft()
    if (showAll()) return canonicalCss()
    const layer = getSelectedLayer()
    if (!layer) return '/* No layer selected */'
    return generateLayerCss(doc, layer.id)
  })

  // Reactive read is synchronous; async highlight runs outside tracking scope.
  // Skipped entirely while editing — the textarea has no highlighting.
  createEffect(() => {
    if (editing()) return
    const code = rawCss() // tracked
    setHighlighted(null)
    // untrack: async side-effect must not create reactive subscriptions
    untrack(() => {
      highlight(code).then(setHighlighted)
    })
  })

  onMount(loadShiki)

  // ── Status-only debounced parse (plan §3.3) ───────────────────────────
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const d = draft()
    if (!editing()) return
    untrack(() => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => setDebouncedDraft(d), LIVE_PARSE_DEBOUNCE_MS)
    })
  })
  onCleanup(() => clearTimeout(debounceTimer))

  /** Mirrors DocBar's live-parse modal memo; drives status + enablement ONLY. */
  const liveParse = createMemo(() => {
    if (!editing()) return null
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
    if (!editing()) return null
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
    if (!editing()) return ''
    const layers = unrepresentableLayers(doc)
    if (layers.length === 0) return ''
    const parts = layers.map((l) => {
      const reason = snapshotExclusionReason(l)
      return `"${l.name}" ${reason === 'hidden' ? 'is hidden' : 'has no keyframes yet'}`
    })
    return `Not in the editable text (kept untouched on commit): ${parts.join(', ')}.`
  }

  // ── Actions ────────────────────────────────────────────────────────────

  let savedTimer: ReturnType<typeof setTimeout> | undefined
  function flashSaved() {
    clearTimeout(savedTimer)
    setSavedFlash(true)
    savedTimer = setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS)
  }
  onCleanup(() => clearTimeout(savedTimer))

  function enterEdit() {
    // Editing is full-doc in Phase A — switch scopes automatically rather
    // than leaving the button silently disabled (owner hit exactly that).
    if (!showAll()) setShowAll(true)
    const snap = canonicalCss()
    setDraft(snap)
    setCommittedText(snap)
    setSyncedCanonical(snap)
    setDebouncedDraft(snap) // instant status on entry, no debounce wait
    setEditing(true)
  }

  function reloadDraft() {
    const c = canonicalCss()
    setDraft(c)
    setCommittedText(c)
    setSyncedCanonical(c)
  }

  function cancelEdit() {
    if (isDirty() && !window.confirm('Discard unsaved changes to the CSS?')) return
    setEditing(false)
  }

  /**
   * Commit path: enrich → replaceDoc → re-select by name → clear keyframe
   * selection → pause → clamp playhead. The textarea is NOT rewritten from
   * canonical output afterwards (user formatting isn't canonical format, and
   * rewriting moves the caret); "Saved ✓" acknowledges instead.
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
    setCommittedText(draft())
    setSyncedCanonical(canonicalCss()) // our own commit is not an external change
    flashSaved()
    return true
  }

  function doneCommit() {
    if (applyCommit()) setEditing(false)
  }

  function onEditorKeyDown(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      applyCommit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(rawCss()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div class="code-view">
      <div class="code-view__toolbar">
        <label
          class="code-view__scope-toggle"
          title={editing() ? 'Finish editing to change scope' : undefined}
        >
          <input
            type="checkbox"
            checked={showAll()}
            disabled={editing()}
            onChange={(e) => setShowAll(e.currentTarget.checked)}
          />
          Full doc
        </label>
        <div class="code-view__actions">
          <Show when={!editing()}>
            <button
              class="btn btn--ghost code-view__btn"
              onClick={enterEdit}
              title="Edit the generated CSS (edits apply to the full document)"
            >
              Edit
            </button>
          </Show>
          <Show when={editing()}>
            <button
              class="btn btn--primary code-view__btn"
              onClick={applyCommit}
              disabled={!canApply()}
              title="Apply changes to the document (Ctrl/Cmd+Enter)"
            >
              Apply
            </button>
            <button
              class="btn btn--primary code-view__btn"
              onClick={doneCommit}
              disabled={!canApply()}
              title="Apply changes and stop editing"
            >
              Done
            </button>
            <button
              class="btn btn--ghost code-view__btn"
              onClick={cancelEdit}
              title="Discard changes and stop editing (Esc)"
            >
              Cancel
            </button>
          </Show>
          <button
            class="btn btn--ghost code-view__copy-btn"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            {copied() ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <Show when={editing()}>
        {/* Persistent polite live region under the toolbar (DocBar pattern):
            parse problems are announced without stealing focus, never a modal. */}
        <div class="code-view__statusbar">
          <Show when={excludedNotice()}>
            <p class="code-view__notice">{excludedNotice()}</p>
          </Show>
          <Show when={externalChanged()}>
            <span class="code-view__chip">
              Document changed outside editor
              <button class="btn btn--ghost code-view__chip-btn" onClick={reloadDraft}>
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
      </Show>

      <Show
        when={editing()}
        fallback={
          <>
            {highlighted() ? (
              // Shiki output is self-generated — not user input, no XSS risk.
              // eslint-disable-next-line solid/no-innerhtml
              <div class="code-view__highlighted" innerHTML={highlighted()!} />
            ) : (
              <pre class="code-view__plain">
                <code>{rawCss()}</code>
              </pre>
            )}
          </>
        }
      >
        <textarea
          class="input code-view__textarea"
          value={draft()}
          aria-label="CSS editor"
          spellcheck={false}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={onEditorKeyDown}
          ref={(el) => {
            // Focus once on entering edit mode (refs re-run on Show mount).
            queueMicrotask(() => el.focus())
          }}
        />
      </Show>
    </div>
  )
}
