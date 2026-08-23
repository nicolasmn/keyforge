import type { AnimationDocument, Layer, Track, Keyframe, AnimatableProperty } from '@/types'
import { nanoid } from './nanoid'

/**
 * Parse pasted CSS containing `@keyframes` rules into a Keyforge document.
 *
 * Scope (deliberate): one layer per @keyframes rule; stops become keyframes;
 * properties within a stop group into tracks. Per-stop
 * `animation-timing-function` maps to the keyframe's easing. The companion
 * selector block (`animation-duration`) sets the document duration when the
 * keyforge export shape is recognized.
 */

export interface CssImportResult {
  doc: AnimationDocument | null
  warnings: string[]
}

const ANIMATABLE: readonly AnimatableProperty[] = [
  'opacity',
  'transform',
  'background-color',
  'color',
  'border-radius',
  'width',
  'height',
  'scale',
  'translate',
  'rotate',
]

function asAnimatable(prop: string): AnimatableProperty | null {
  const p = prop.trim().toLowerCase()
  return (ANIMATABLE as readonly string[]).includes(p) ? (p as AnimatableProperty) : null
}

/** Extract the first top-level @keyframes block starting at `from`. */
function extractKeyframesBlock(css: string, from: number): { body: string; end: number } | null {
  const start = css.indexOf('@keyframes', from)
  if (start === -1) return null
  const braceOpen = css.indexOf('{', start)
  if (braceOpen === -1) return null
  let depth = 1
  let i = braceOpen + 1
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
    i++
  }
  if (depth !== 0) return null // unbalanced → treat as malformed
  return {
    body: css.slice(braceOpen + 1, i - 1),
    end: i,
  }
}

function parseName(header: string): string {
  return header
    .replace(/^@keyframes\s+/, '')
    .trim()
    .replace(/["']/g, '')
}

interface RawStop {
  pct: number
  props: Map<string, string>
  timing?: string
}

/** Parse "0% { ... } 50% { ... }" style stops inside a keyframes body. */
function parseStops(body: string): RawStop[] {
  const stops: RawStop[] = []
  const stopRe = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = stopRe.exec(body))) {
    const selectors = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const decls = m[2]
    for (const sel of selectors) {
      const pct = parseSelectorPercent(sel)
      if (pct === null) continue
      const props = new Map<string, string>()
      let timing: string | undefined
      for (const decl of decls.split(';')) {
        const colon = decl.indexOf(':')
        if (colon === -1) continue
        const prop = decl.slice(0, colon).trim().toLowerCase()
        const value = decl.slice(colon + 1).trim()
        if (!prop || !value) continue
        if (prop === 'animation-timing-function') {
          timing = value
        } else {
          props.set(prop, value)
        }
      }
      stops.push({ pct, props, timing })
    }
  }
  return stops.sort((a, b) => a.pct - b.pct)
}

function parseSelectorPercent(sel: string): number | null {
  const s = sel.trim().toLowerCase()
  if (s === 'from' || s === '0%') return 0
  if (s === 'to' || s === '100%') return 100
  const m = /^([\d.]+)%$/.exec(s)
  if (!m) return null
  const n = Number.parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}

/** Read duration from a keyforge-style companion block, else default. */
function sniffDurationMs(css: string): number {
  const m = /animation-duration:\s*([\d.]+)(ms|s)\b/.exec(css)
  if (!m) return 2000
  const n = Number.parseFloat(m[1])
  return m[2] === 's' ? Math.round(n * 1000) : Math.round(n)
}

export function parseCssToDoc(css: string): CssImportResult {
  const warnings: string[] = []
  if (!css || !css.includes('@keyframes')) {
    return { doc: null, warnings: ['No @keyframes rules found in the pasted CSS.'] }
  }

  const layers: Layer[] = []
  let cursor = 0
  let index = 0

  while (true) {
    const block = extractKeyframesBlock(css, cursor)
    if (!block) break
    cursor = block.end
    const headerEnd = css.lastIndexOf('@keyframes', block.end)
    const header = css.slice(css.indexOf('@keyframes', headerEnd), css.indexOf('{', headerEnd))
    const name = parseName(header)

    const stops = parseStops(block.body)
    if (stops.length === 0) {
      warnings.push(`@keyframes ${name}: no usable stops, skipped.`)
      continue
    }

    // Group property values across stops into tracks.
    const byProp = new Map<string, { time: number; value: string; easing?: string }[]>()
    for (const stop of stops) {
      for (const [prop, value] of stop.props) {
        const list = byProp.get(prop) ?? []
        list.push({ time: stop.pct, value, easing: stop.timing })
        byProp.set(prop, list)
      }
    }

    const tracks: Track[] = []
    for (const [prop, entries] of byProp) {
      const animatable = asAnimatable(prop)
      if (!animatable) {
        warnings.push(`@keyframes ${name}: unsupported property "${prop}" skipped.`)
        continue
      }
      const keyframes: Keyframe[] = entries.map((e) => ({
        id: nanoid(),
        time: e.time,
        value: e.value,
        easing: 'linear',
      }))
      tracks.push({ id: nanoid(), property: animatable, keyframes })
    }

    if (tracks.length === 0) {
      warnings.push(`@keyframes ${name}: no supported properties, skipped.`)
      continue
    }

    // Per-stop timing functions apply to all tracks' KFs at that stop.
    if (stops.some((s) => s.timing)) {
      for (const track of tracks) {
        for (const kf of track.keyframes) {
          const timing = stops.find((s) => s.pct === kf.time)?.timing
          if (timing) (kf as { easing?: string }).easing = timing
        }
      }
    }

    index++
    layers.push({
      id: nanoid(),
      name: name || `Imported ${index}`,
      visible: true,
      element: {
        tag: 'div',
        text: '',
        initialCss: 'width:80px;height:80px;background-color:hsl(264 80% 68%);border-radius:8px;',
      },
      tracks,
    })
  }

  if (layers.length === 0) {
    return { doc: null, warnings: [...warnings, 'Nothing importable was found.'] }
  }

  const doc: AnimationDocument = {
    id: nanoid(),
    name: 'Imported animation',
    duration: sniffDurationMs(css),
    layers,
  }
  return { doc, warnings }
}
