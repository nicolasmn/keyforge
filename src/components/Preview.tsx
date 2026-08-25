import { createEffect, createMemo, For, onCleanup, onMount, untrack } from 'solid-js'
import {
  doc,
  playing,
  setPlaying,
  playhead,
  setPlayhead,
  loop,
  playbackRate,
  workAreaStart,
  workAreaEnd,
  selectedLayerId,
  setSelectedLayerId,
} from '@/store'
import OriginOverlay from '@/components/OriginOverlay'
import TransformOverlay from '@/components/TransformOverlay'
import { generateCss } from '@/utils/css'
import { slugify } from '@/utils/slugify'
import { mergeInitialCss } from '@/utils/originMath'

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
      const rate = untrack(playbackRate)
      const waStart = untrack(workAreaStart)
      const waEnd = Math.min(untrack(workAreaEnd), duration)
      let next = untrack(playhead) + dt * rate

      if (next >= duration) {
        if (isLoop) {
          next = next % duration
        } else {
          setPlayhead(duration)
          setPlaying(false)
          return
        }
      }

      // Work-area bookends: while looping, wrap inside [start, end] instead
      // of the full document. One-shot playback (loop off) ignores them.
      if (isLoop && waEnd > waStart && next >= waEnd) {
        next = waStart + ((next - waStart) % (waEnd - waStart))
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
                ...mergeInitialCss(layer.element),
                ...(layer.visible === false ? { visibility: 'hidden' } : {}),
              }}
              onClick={() => {
                // Stage→selection link (gizmo UX spec §3): clicking a layer
                // selects it, mirroring the timeline header rows. Hidden
                // layers can't receive pointer events, so no guard needed.
                if (selectedLayerId() !== layer.id) setSelectedLayerId(layer.id)
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
        {/* Transform gizmos (move/rotate/scale) — mounted AFTER OriginOverlay
            so pick mode wins; the component suppresses itself entirely while
            originPicking() is true and paints below origin overlay z-index. */}
        <TransformOverlay />
      </div>
    </div>
  )
}
