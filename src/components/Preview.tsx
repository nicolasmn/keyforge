import { createEffect, createMemo, For, onCleanup, onMount, untrack } from 'solid-js'
import { doc, playing, setPlaying, playhead, setPlayhead, loop } from '@/store'
import OriginOverlay from '@/components/OriginOverlay'
import { generateCss } from '@/utils/css'
import { slugify } from '@/utils/slugify'

function parseCssString(css: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const decl of css.split(';')) {
    const colon = decl.indexOf(':')
    if (colon === -1) continue
    const prop = decl.slice(0, colon).trim()
    const value = decl.slice(colon + 1).trim()
    if (prop && value) result[prop] = value
  }
  return result
}

export default function Preview() {
  let styleEl: HTMLStyleElement | undefined
  let panelRef: HTMLDivElement | undefined
  let rafId = 0
  let lastTs = 0

  const docStructure = createMemo(() =>
    JSON.stringify(
      doc.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        duration: doc.duration,
        tracks: l.tracks.map((t) => ({
          id: t.id,
          property: t.property,
          keyframes: t.keyframes.map((k) => ({
            id: k.id,
            time: k.time,
            value: k.value,
            easing: k.easing,
          })),
        })),
      })),
    ),
  )

  createEffect(() => {
    const _structure = docStructure()
    untrack(() => {
      if (!styleEl) return
      const snapshot = JSON.parse(_structure) as typeof doc.layers
      styleEl.textContent = generateCss({ ...doc, layers: snapshot })
    })
  })

  createEffect(() => {
    const ph = playhead()
    document.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((el) => {
      el.style.animationDelay = `-${ph}ms`
    })
  })

  createEffect(() => {
    if (!playing()) {
      cancelAnimationFrame(rafId)
      lastTs = 0
      return
    }

    lastTs = 0
    const tick = (ts: number) => {
      const dt = lastTs === 0 ? 0 : ts - lastTs
      lastTs = ts

      const duration = untrack(() => doc.duration)
      const isLoop = untrack(loop)
      let next = untrack(playhead) + dt

      if (next >= duration) {
        if (isLoop) {
          next = next % duration
        } else {
          setPlayhead(duration)
          setPlaying(false)
          return
        }
      }

      setPlayhead(next)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
  })

  onCleanup(() => cancelAnimationFrame(rafId))

  // Audit F16: the stage is authored at a fixed 600×400, which clips inside
  // narrow panels. Track the panel's live box and publish `--preview-scale`
  // (consumed by .split-shell .preview__canvas in app.css) so the stage
  // scales down to fit instead of being cropped by overflow:hidden.
  onMount(() => {
    if (!panelRef || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 0, height: 0 }
      if (!(width > 0) || !(height > 0) || !panelRef) return
      // Denominators leave breathing room around the 602×402 bordered stage.
      const scale = Math.min(1, width / 620, height / 420)
      panelRef.style.setProperty('--preview-scale', String(scale))
    })
    observer.observe(panelRef)
    onCleanup(() => observer.disconnect())
  })

  return (
    <div class="preview" ref={panelRef}>
      <style ref={styleEl} />
      <div class="preview__canvas">
        <For each={doc.layers}>
          {(layer) => (
            <div
              data-layer-id={slugify(layer.name)}
              style={{
                ...parseCssString(layer.element.initialCss),
                ...(layer.visible === false ? { visibility: 'hidden' } : {}),
              }}
            >
              {layer.element.text}
            </div>
          )}
        </For>
        {/* Transform-origin debug view + pick surface. Sibling AFTER the
            layers (plan §3): the overlay is position:absolute inset:0, so
            it never joins the canvas flex flow and only stacks above it. */}
        <OriginOverlay />
      </div>
    </div>
  )
}
