import { createEffect, For, onCleanup, untrack } from 'solid-js'
import { doc, playing, playhead, setPlayhead, loop } from '@/store'
import { generateCss } from '@/utils/css'

export default function Preview() {
  let styleEl: HTMLStyleElement | undefined
  let rafId: number
  let startTime: number | null = null
  let startPlayhead: number = 0

  // Only regenerate CSS when doc structure changes (layers/tracks/keyframes)
  // untrack(playing) and untrack(playhead) so playback doesn't trigger a reset
  createEffect(() => {
    // Subscribe only to structural doc data
    const layers = doc.layers.map((l) => ({
      id: l.id,
      tracks: l.tracks.map((t) => ({
        id: t.id,
        property: t.property,
        keyframes: t.keyframes.map((k) => ({ id: k.id, time: k.time, value: k.value, easing: k.easing })),
      })),
    }))
    const duration = doc.duration

    untrack(() => {
      if (!styleEl) return
      styleEl.textContent = generateCss({ ...doc, layers: layers as typeof doc.layers, duration })
    })
  })

  // Playback RAF loop
  createEffect(() => {
    if (playing()) {
      startPlayhead = untrack(playhead)
      startTime = null
      const tick = (now: number) => {
        if (startTime === null) startTime = now
        const elapsed = now - startTime
        let next = startPlayhead + elapsed
        if (next >= doc.duration) {
          if (loop()) {
            next = next % doc.duration
            startTime = now
            startPlayhead = 0
          } else {
            next = doc.duration
            setPlayhead(next)
            return
          }
        }
        setPlayhead(next)
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(rafId)
    }
  })

  onCleanup(() => cancelAnimationFrame(rafId))

  // Scrub: drive paused animation via negative animation-delay
  createEffect(() => {
    const ph = playhead()
    if (untrack(playing)) return
    document.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((el) => {
      el.style.animationDelay = `-${ph}ms`
    })
  })

  return (
    <div class="preview">
      <style ref={styleEl} />
      <div
        class="preview__canvas"
        style={{ '--play-state': playing() ? 'running' : 'paused' }}
      >
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
