/**
 * CodeView — read-only CSS output panel.
 *
 * Renders live generateCss() output for either:
 *   - the selected layer only (default)
 *   - the full document (toggle)
 *
 * Syntax highlighting via Shiki (loaded from CDN, async).
 * Falls back to plain <pre> if Shiki hasn't loaded yet or fails.
 *
 * Copy button writes the raw (unhighlighted) string to clipboard.
 */
import { createSignal, createMemo, createEffect, onMount } from 'solid-js'
import { doc, selectedLayerId, getSelectedLayer } from '@/store'
import { generateCss } from '@/utils/css'
import { generateLayerCss } from '@/utils/css'

// Shiki is loaded once, lazily, on first render.
let highlighter: { codeToHtml: (code: string, opts: object) => string } | null = null
let shikiReady = false

async function loadShiki() {
  if (shikiReady) return
  try {
    const { createHighlighter } = await import(
      'https://esm.sh/shiki@1?bundle=true'
    )
    highlighter = await createHighlighter({
      themes: ['dark-plus'],
      langs: ['css'],
    })
    shikiReady = true
  } catch {
    // Shiki unavailable (offline / CDN blocked) — plain text fallback stays active
  }
}

export default function CodeView() {
  const [showAll, setShowAll] = createSignal(false)
  const [highlighted, setHighlighted] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)

  // Raw CSS string — recomputed whenever store or toggle changes
  const rawCss = createMemo(() => {
    if (showAll()) {
      return generateCss(doc)
    }
    const layer = getSelectedLayer()
    if (!layer) return '/* No layer selected */'
    return generateLayerCss(doc, layer.id)
  })

  // Re-highlight whenever raw CSS changes
  createEffect(async () => {
    const code = rawCss() // reactive read
    if (!shikiReady) {
      setHighlighted(null)
      await loadShiki()
    }
    if (!highlighter) {
      setHighlighted(null)
      return
    }
    const html = highlighter.codeToHtml(code, {
      lang: 'css',
      theme: 'dark-plus',
    })
    setHighlighted(html)
  })

  onMount(loadShiki)

  function handleCopy() {
    navigator.clipboard.writeText(rawCss()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div class="code-view">
      <div class="code-view__toolbar">
        <label class="code-view__scope-toggle">
          <input
            type="checkbox"
            checked={showAll()}
            onChange={(e) => setShowAll(e.currentTarget.checked)}
          />
          Full doc
        </label>
        <button
          class="btn btn--ghost code-view__copy-btn"
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          {copied() ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {highlighted() ? (
        // Shiki wraps output in <pre class="shiki"><code>...</code></pre>
        <div
          class="code-view__highlighted"
          innerHTML={highlighted()!}
        />
      ) : (
        <pre class="code-view__plain">
          <code>{rawCss()}</code>
        </pre>
      )}
    </div>
  )
}
