import { createEffect, For, onCleanup, untrack } from 'solid-js'
import { doc, playing, playhead, setPlayhead, loop } from '@/store'
import { generateCss } from '@/utils/css'

function layerEls(): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>('[data-layer-id]')
}

function applyPaused(ph: number) {
  layerEls().forEach((el) => {
    el.style.animationDelay = `-${ph}ms`
    el.style.animationPlayState = 'paused'
  })
}

function applyPlaying(fromMs: number) {
  layerEls().forEach((el) => {
    el.style.animationPlayState = 'paused'
    el.style.animationDelay = `-${fromMs}ms`
    void el.offsetWidth
    el.style.animationPlayState = 'running'
  })
}

export default function Preview() {
  let styleEl: HTMLStyleElement | undefined
  let rafId: number
  let startTime: number | null = null
  let startPlayhead: number = 0

  createEffect(() => {
    void doc.layers.map((l) => ({
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

    untrack(() => {
      if (!styleEl) return
      styleEl.textContent = generateCss(doc)
      applyPaused(playhead())
    })
  })

  createEffect(() => {
    if (playing()) {
      startPlayhead = untrack(playhead)
      startTime = null
      applyPlaying(startPlayhead)

      const tick = (now: number) => {
        if (startTime === null) startTime = now
        const elapsed = now - startTime
        let next = startPlayhead + elapsed

        if (next >= doc.duration) {
          if (loop()) {
            startPlayhead = 0
            startTime = now
            next = 0
            applyPlaying(0)
          } else {
            next = doc.duration
            setPlayhead(next)
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
      applyPaused(untrack(playhead))
    }
  })

  onCleanup(() => cancelAnimationFrame(rafId))

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
