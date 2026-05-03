import { createEffect, createMemo, For, onCleanup, untrack } from 'solid-js'
import { doc, playing, setPlaying, playhead, setPlayhead, loop } from '@/store'
import { generateCss } from '@/utils/css'

/**
 * Preview — JS-owned time model.
 *
 * CSS animations are ALWAYS paused. Position driven exclusively by
 * `animation-delay: -${playhead}ms` set as inline style on each layer element.
 * The RAF loop advances the playhead signal; everything else reacts to it.
 */
export default function Preview() {
  let styleEl: HTMLStyleElement | undefined
  let rafId = 0
  let lastTs = 0

  // Structural fingerprint: only changes on layers/tracks/keyframes/duration edits.
  // createMemo ensures a stable reactive dependency — no `void` trick.
  const docStructure = createMemo(() =>
    JSON.stringify(
      doc.layers.map((l) => ({
        id: l.id,
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
  // generateCss receives a plain-object snapshot — no reactive reads inside untrack.
  createEffect(() => {
    const _structure = docStructure() // reactive subscription
    untrack(() => {
      if (!styleEl) return
      // Snapshot: spread doc into a plain object so generateCss reads no signals
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

  // RAF loop — advances playhead when playing; calls setPlaying(false) at end
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
          // Reached end: snap to duration, stop playing
          setPlayhead(duration)
          setPlaying(false) // resets play button state
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
            <div data-layer-id={layer.id} style={layer.element.initialCss}>
              {layer.element.text}
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
