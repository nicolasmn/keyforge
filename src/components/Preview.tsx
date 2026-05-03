import { createEffect, For, onCleanup } from 'solid-js'
import { doc, playing, playhead, setPlayhead, loop } from '@/store'
import { generateCss } from '@/utils/css'

export default function Preview() {
  let styleEl: HTMLStyleElement | undefined
  let rafId: number
  let startTime: number | null = null
  let startPlayhead: number = 0

  // Inject/update keyframe CSS whenever doc changes
  createEffect(() => {
    const css = generateCss(doc)
    if (!styleEl) return
    styleEl.textContent = css
  })

  // Playback loop
  createEffect(() => {
    if (playing()) {
      startPlayhead = playhead()
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

  // Sync animation delay to playhead position when paused
  createEffect(() => {
    const ph = playhead()
    if (playing()) return
    // Drive paused animation by setting negative delay = scrub position
    document.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((el) => {
      el.style.animationDelay = `-${ph}ms`
    })
  })

  return (
    <div class="preview">
      <style ref={styleEl} />
      <div
        class="preview__canvas"
        style={{
          '--play-state': playing() ? 'running' : 'paused',
        }}
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
