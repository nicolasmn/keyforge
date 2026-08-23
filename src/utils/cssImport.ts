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
 *
 * Split-export merging: Keyforge emits ONE @keyframes rule PER TRACK, named
 * `<base>-<index>`. When EVERY parsed rule name ends in `-<number>`, rules
 * sharing a base are merged back into one layer named `<base>` (tracks
 * concatenated in index order) — so importing a Keyforge export round-trips
 * to the original layer count. A lone rule without the suffix stays its own
 * layer.
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
  let name = header
    .replace(/^@keyframes\s+/, '')
    .trim()
    .replace(/["']/g, '')
  // Keyforge's own exports prefix kf-; importing an exported document
  // shouldn't accumulate prefixes on every round-trip.
  if (name.startsWith('kf-')) name = name.slice(3)
  return name
}

interface RawStop {
  pct: number
  props: Map<string, { value: string; easing?: string }>
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
      // A timing-function pairs with the property declaration that
      // immediately precedes it (our exporter emits it right after the
      // property whose keyframe carries that easing). A leading
      // timing-function with no preceding property applies to the stop
      // as a whole — matching CSS's per-stop semantics.
      const props = new Map<string, string>()
      const propTiming = new Map<string, string>()
      let pendingTiming: string | undefined
      let lastProp: string | null = null
      for (const decl of decls.split(';')) {
        const colon = decl.indexOf(':')
        if (colon === -1) continue
        const prop = decl.slice(0, colon).trim().toLowerCase()
        const value = decl.slice(colon + 1).trim()
        if (!prop || !value) continue
        if (prop === 'animation-timing-function') {
          if (lastProp) {
            propTiming.set(lastProp, value)
          } else {
            pendingTiming = value
          }
        } else {
          props.set(prop, value)
          if (pendingTiming && !propTiming.has(prop)) {
            propTiming.set(prop, pendingTiming)
            pendingTiming = undefined
          }
          lastProp = prop
        }
      }
      for (const sel2 of [sel]) {
        void sel2
        const stopProps = new Map(props)
        // Apply stop-wide timing to properties without their own pairing.
        const resolved = new Map<string, { value: string; easing?: string }>()
        for (const [p, v] of stopProps) {
          resolved.set(p, { value: v, easing: propTiming.get(p) ?? pendingTiming })
        }
        stops.push({ pct, props: resolved })
      }
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

/** `<base>-<index>` — e.g. "box-0" → base "box", index 0. Greedy base so
 *  nested suffixes like "slide-in-2" resolve to base "slide-in". */
const SPLIT_NAME_RE = /^(.+)-(\d+)$/

interface SplitPart {
  layer: Layer
  index: number
}

/**
 * Merge per-track split rules (`<base>-0`, `<base>-1`, …) back into single
 * layers named `<base>`. Applied only when EVERY parsed rule name carries the
 * numeric suffix — the signature of a Keyforge always-split export — so
 * hand-written CSS with plain rule names is untouched. Grouping is then
 * unambiguous (no bare-name collision is possible since every name is
 * suffixed), and each base group merges with tracks concatenated in index
 * order.
 */
export function mergeSplitLayers(layers: Layer[]): Layer[] {
  if (layers.length === 0) return layers
  if (!layers.every((l) => SPLIT_NAME_RE.test(l.name))) return layers

  const groups = new Map<string, { parts: SplitPart[]; order: number }>()
  layers.forEach((layer, i) => {
    const m = SPLIT_NAME_RE.exec(layer.name)!
    const g = groups.get(m[1]) ?? { parts: [], order: i }
    g.parts.push({ layer, index: Number.parseInt(m[2], 10) })
    groups.set(m[1], g)
  })

  // Stable output order: first appearance of each base.
  return [...groups.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([base, { parts }]) => {
      // Index order = track order in the original document.
      parts.sort((a, b) => a.index - b.index)
      return {
        ...parts[0].layer,
        name: base,
        tracks: parts.flatMap((p) => p.layer.tracks),
      }
    })
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
      for (const [prop, decl] of stop.props) {
        const list = byProp.get(prop) ?? []
        list.push({ time: stop.pct, value: decl.value, easing: decl.easing })
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
        easing: (e.easing ?? 'linear') as Keyframe['easing'],
      }))
      tracks.push({ id: nanoid(), property: animatable, keyframes })
    }

    if (tracks.length === 0) {
      warnings.push(`@keyframes ${name}: no supported properties, skipped.`)
      continue
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

  // Keyforge's own export splits each layer into per-track rules
  // (`kf-<slug>-<i>`); re-join them so one import yields one layer.
  const mergedLayers = mergeSplitLayers(layers)

  // Percent stops are relative to the animation duration; Keyforge stores
  // keyframe times in milliseconds. Convert after the duration is known.
  const duration = sniffDurationMs(css)
  for (const layer of mergedLayers) {
    for (const track of layer.tracks) {
      for (const kf of track.keyframes) {
        kf.time = Math.round((kf.time / 100) * duration)
      }
      track.keyframes.sort((a, b) => a.time - b.time)
      // Exporters synthesize gap-fill stops (a stop whose value merely
      // repeats the previous one with default timing). They have zero
      // visual effect — CSS holds the value anyway — so drop them:
      // keeping them would multiply on every export→import cycle.
      const kept: Keyframe[] = []
      for (const kf of track.keyframes) {
        const prev = kept[kept.length - 1]
        const isFill = prev !== undefined && prev.value === kf.value && kf.easing === 'linear'
        if (!isFill) kept.push(kf)
      }
      track.keyframes = kept
    }
  }

  const doc: AnimationDocument = {
    id: nanoid(),
    name: 'Imported animation',
    duration,
    layers: mergedLayers,
  }
  return { doc, warnings }
}
