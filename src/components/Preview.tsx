import { createEffect, For, onCleanup, untrack } from 'solid-js'
import { doc, playing, playhead, setPlayhead, loop } from '@/store'
import { generateCss } from '@/utils/css'

/**
 * Preview uses a single source of truth: the `playhead` signal (ms).
 *
 * CSS animations are ALWAYS paused. Position is driven exclusively by
 * `animation-delay: -${playhead}ms` on each layer element.
 *
 * The RAF loop advances the playhead signal when playing.
 * Everything — scrubbing, play, pause, stop — goes through setPlayhead.
 * No CSS play-state toggling, no reflow tricks, no dual sources of truth.
 */
export default function Preview() {
  let styleEl: HTMLStyleElement | undefined
  let rafId = 0
  let lastTs = 0

  // ── CSS injection ────────────────────────────────────────────
  // Only re-runs when doc structure changes (layers/tracks/keyframes/duration).
  // Reads playhead via untrack so ticks never trigger a style reset.
  createEffect(() => {
    void doc.duration
    void doc.layers.map((l) => ({
      id: l.id,
      tracks: l.tracks.map((t) => ({
        id: t.id,
        property: t.property,
        keyframes: t.keyframes.map((k) => ({
          id: k.id, time: k.time, value: k.value, easing: k.easing,
        })),
      })),
    }))
    untrack(() => {
      if (!styleEl) return
      styleEl.textContent = generateCss(doc)
    })
  })

  // ── Sync layer elements to playhead ──────────────────────────
  // Runs on every playhead change. CSS is always paused; delay = -playhead.
  createEffect(() => {
    const ph = playhead()
    document.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((el) => {
      el.style.animationDelay = `-${ph}ms`
    })
  })

  // ── RAF loop ─────────────────────────────────────────────────
  // Advances playhead at real wall-clock speed when playing.
  // Stops itself when playing() becomes false.
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
          // Stop — this will cause playing() to be false on next effect run,
          // but we stop the loop ourselves immediately.
          cancelAnimationFrame(rafId)
          return
        }
      }

      setPlayhead(next)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    onCleanup(() => cancelAnimationFrame(rafId))
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
