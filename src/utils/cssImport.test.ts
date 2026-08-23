import { describe, it, expect } from 'vitest'
import { parseCssToDoc } from './cssImport'

const simple = `@keyframes pulse {
  0% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}`

const withDuration = `${simple}

[data-target] {
  animation-name: pulse;
  animation-duration: 3s;
}`

const realWorld = `@keyframes slide-in {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.slide-in-element {
  animation: slide-in 0.5s ease-out both;
}`

describe('parseCssToDoc', () => {
  it('parses a simple keyframes rule into one layer with one track', () => {
    const { doc, warnings } = parseCssToDoc(simple)
    expect(doc).not.toBeNull()
    expect(warnings).toEqual([])
    expect(doc!.layers).toHaveLength(1)
    const layer = doc!.layers[0]
    expect(layer.name).toBe('pulse')
    expect(layer.tracks).toHaveLength(1)
    expect(layer.tracks[0].property).toBe('opacity')
    // Percent stops convert to ms against the sniffed/default duration (2000ms)
    expect(layer.tracks[0].keyframes.map((k) => [k.time, k.value])).toEqual([
      [0, '0'],
      [1000, '1'],
      [2000, '0'],
    ])
  })

  it('reads duration from a companion animation-duration (s and ms)', () => {
    expect(parseCssToDoc(withDuration).doc!.duration).toBe(3000)
    const ms = parseCssToDoc(simple + '\nanimation-duration: 750ms;')
    expect(ms.doc!.duration).toBe(750)
    expect(parseCssToDoc(simple).doc!.duration).toBe(2000) // default
  })

  it('maps from/to selectors and multi-property stops', () => {
    const { doc } = parseCssToDoc(realWorld)
    const layer = doc!.layers[0]
    expect(layer.name).toBe('slide-in')
    const props = layer.tracks.map((t) => t.property).sort()
    expect(props).toEqual(['opacity', 'transform'])
    const tf = layer.tracks.find((t) => t.property === 'transform')!
    expect(tf.keyframes.map((k) => k.value)).toEqual(['translateX(-100%)', 'translateX(0)'])
  })

  it('captures per-stop animation-timing-function as keyframe easing', () => {
    const css = `@keyframes fancy {
      0% { opacity: 0; animation-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1); }
      100% { opacity: 1; }
    }`
    const { doc } = parseCssToDoc(css)
    const kf = doc!.layers[0].tracks[0].keyframes[0]
    expect(kf.easing).toContain('cubic-bezier')
  })

  it('handles multiple @keyframes rules as multiple layers', () => {
    const css = `${simple}\n@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }`
    const { doc } = parseCssToDoc(css)
    expect(doc!.layers).toHaveLength(2)
    expect(doc!.layers.map((l) => l.name)).toEqual(['pulse', 'spin'])
  })

  it('warns and skips unsupported properties but keeps the rest', () => {
    const css = `@keyframes mixed {
      0% { opacity: 0; box-shadow: 0 0 10px black; }
      100% { opacity: 1; box-shadow: 0 0 0 black; }
    }`
    const { doc, warnings } = parseCssToDoc(css)
    const layer = doc!.layers[0]
    expect(layer.tracks.map((t) => t.property)).toEqual(['opacity'])
    expect(warnings.some((w) => w.includes('box-shadow'))).toBe(true)
  })

  it('rejects CSS without keyframes with a helpful warning', () => {
    const r1 = parseCssToDoc('.foo { color: red; }')
    expect(r1.doc).toBeNull()
    expect(r1.warnings[0]).toMatch(/No @keyframes/)

    const r2 = parseCssToDoc('')
    expect(r2.doc).toBeNull()

    const r3 = parseCssToDoc('@keyframes broken { opacity: 1 }') // no stop blocks
    expect(r3.doc).toBeNull()
  })

  it('produces fresh ids on each parse', () => {
    const a = parseCssToDoc(simple).doc!
    const b = parseCssToDoc(simple).doc!
    expect(a.id).not.toBe(b.id)
    expect(a.layers[0].id).not.toBe(b.layers[0].id)
  })
})
