import { createEffect, createMemo, For, onCleanup, untrack } from 'solid-js'
import { doc, playing, setPlaying, playhead, setPlayhead, loop } from '@/store'
import { generateCss } from '@/utils/css'

/**
 * Preview — JS-owned time model.
 *
 * CSS animations are ALWAYS paused. Position driven exclusively by
 * `animation-delay: -${playhead}ms` set as inline style on each layer element.
 * The RAF loop advances the playhead signal; everything else reacts to it.
 *
 * Hidden layers (visible === false) are excluded from generated CSS and
 * rendered with `visibility: hidden` so they hold their layout space.
 */

/** Parse a semicolon-separated inline CSS string into a style object. */
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
  let rafId = 0
  let lastTs = 0

  // Structural fingerprint: only changes on layers/tracks/keyframes/duration/visibility edits.
  const docStructure = createMemo(() =>
    JSON.stringify(
      doc.layers.map((l) => ({
        id: l.id,
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

  // Re-inject CSS only when structure changes.
  createEffect(() => {
    const _structure = docStructure()
    untrack(() => {
      if (!styleEl) return
      const snapshot = JSON.parse(_structure) as typeof doc.layers
      styleEl.textContent = generateCss({ ...doc, layers: snapshot })
    })
  })

  // Sync every layer element's delay to the current playhead
  createEffect(() => {
    const ph = playhead()
    document.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((el) => {
      el.style.animationDelay = `-${ph}ms`
    })
  })

  // RAF loop
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

  return (
    <div class="preview">
      <style ref={styleEl} />
      <div class="preview__canvas">
        <For each={doc.layers}>
          {(layer) => (
            <div
              data-layer-id={layer.id}
              style={{
                ...parseCssString(layer.element.initialCss),
                ...(layer.visible === false ? { visibility: 'hidden' } : {}),
              }}
            >
              {layer.element.text}
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
