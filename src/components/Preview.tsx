import { createEffect, For, onCleanup, untrack } from 'solid-js'
import { doc, playing, playhead, setPlayhead, loop } from '@/store'
import { generateCss } from '@/utils/css'

function layerEls(): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>('[data-layer-id]')
}

function applyPaused(ph: number) {
  layerEls().forEach((el) => {
    el.style.animationPlayState = 'paused'
    el.style.animationDelay = `-${ph}ms`
  })
}

function applyPlaying() {
  layerEls().forEach((el) => {
    el.style.animationPlayState = 'running'
    el.style.animationDelay = '0ms'
  })
}

export default function Preview() {
  let styleEl: HTMLStyleElement | undefined
  let rafId: number
  let startTime: number | null = null
  let startPlayhead: number = 0

  // Re-inject CSS only when doc structure changes, not on playback ticks
  createEffect(() => {
    // Explicitly subscribe to structural fields only
    void doc.layers.map((l) => ({
      id: l.id,
      duration: doc.duration,
      tracks: l.tracks.map((t) => ({
        id: t.id,
        property: t.property,
        keyframes: t.keyframes.map((k) => ({ id: k.id, time: k.time, value: k.value, easing: k.easing })),
      })),
    }))

    untrack(() => {
      if (!styleEl) return
      styleEl.textContent = generateCss(doc)
      // Re-apply paused state after style reset
      applyPaused(playhead())
    })
  })

  // Playback RAF loop
  createEffect(() => {
    if (playing()) {
      startPlayhead = untrack(playhead)
      startTime = null

      // Reset delay to 0 so animation plays from start
      applyPlaying()

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
            // Pause at end
            applyPaused(next)
            return
          }
        }
        setPlayhead(next)
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(rafId)
      // Snap to current playhead when paused/stopped
      applyPaused(untrack(playhead))
    }
  })

  onCleanup(() => cancelAnimationFrame(rafId))

  // Scrub: update delay when paused
  createEffect(() => {
    const ph = playhead()
    if (untrack(playing)) return
    applyPaused(ph)
  })

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
