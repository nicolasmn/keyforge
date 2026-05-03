import { createEffect, createMemo, For, onCleanup, untrack } from 'solid-js'
import { doc, playing, playhead, setPlayhead, loop } from '@/store'
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

  // Structural fingerprint — only changes when layers/tracks/keyframes change,
  // not on every playhead tick. Using createMemo avoids the fragile `void` trick.
  const docStructure = createMemo(() =>
    JSON.stringify(
      doc.layers.map((l) => ({
        id: l.id,
        duration: doc.duration,
        tracks: l.tracks.map((t) => ({
          id: t.id,
          property: t.property,
          keyframes: t.keyframes.map((k) => ({
            id: k.id, time: k.time, value: k.value, easing: k.easing,
          })),
        })),
      }))
    )
  )

  // Re-inject CSS only when structure changes
  createEffect(() => {
    void docStructure() // subscribe
    untrack(() => {
      if (!styleEl) return
      styleEl.textContent = generateCss(doc)
    })
  })

  // Sync layer elements to playhead on every tick
  createEffect(() => {
    const ph = playhead()
    document.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((el) => {
      el.style.animationDelay = `-${ph}ms`
    })
  })

  // RAF loop — advances playhead when playing
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
          next = duration
          setPlayhead(next)
          cancelAnimationFrame(rafId)
          return
        }
      }

      setPlayhead(next)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
  })

  // Single top-level cleanup — no duplicate inside the RAF effect
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
