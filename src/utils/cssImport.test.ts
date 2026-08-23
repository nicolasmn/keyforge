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

  describe('split-export merging (per-track kf-<slug>-<i> rules)', () => {
    // Shape produced by Keyforge's always-split exporter: one @keyframes per
    // track, named `<base>-<index>`, all referenced from one animation-name.
    const splitExport = `@keyframes kf-box-0 {
  0.00% { opacity:0; }
  100.00% { opacity:1; }
}
@keyframes kf-box-1 {
  0.00% { transform:translateY(40px); }
  60.00% { transform:translateY(0px); }
  100.00% { transform:translateY(0px); }
}

[data-layer-id="box"] {
  animation-name: kf-box-0, kf-box-1;
  animation-duration: 5000ms;
  animation-timing-function: linear;
  animation-fill-mode: both;
  animation-play-state: paused;
}`

    it('merges per-track rules back into one layer named <base>', () => {
      const { doc, warnings } = parseCssToDoc(splitExport)
      expect(warnings).toEqual([])
      expect(doc!.layers).toHaveLength(1)
      const layer = doc!.layers[0]
      expect(layer.name).toBe('box')
      // Tracks concatenated in index order: rule -0 first, then rule -1.
      expect(layer.tracks.map((t) => t.property)).toEqual(['opacity', 'transform'])
    })

    it('converts merged stops to ms and drops boundary-hold fills', () => {
      const { doc } = parseCssToDoc(splitExport)
      const layer = doc!.layers[0]
      const opacity = layer.tracks.find((t) => t.property === 'opacity')!
      expect(opacity.keyframes.map((k) => [k.time, k.value])).toEqual([
        [0, '0'],
        [5000, '1'],
      ])
      const transform = layer.tracks.find((t) => t.property === 'transform')!
      // The 100% stop merely repeats the 60% value with default timing —
      // a zero-effect fill synthesized by the exporter — so it is dropped.
      expect(transform.keyframes.map((k) => [k.time, k.value])).toEqual([
        [0, 'translateY(40px)'],
        [3000, 'translateY(0px)'],
      ])
    })

    it('merges a lone suffixed rule to its base (single-track layer round-trips)', () => {
      const css = `@keyframes kf-solo-0 {\n  0% { rotate:0deg; }\n  100% { rotate:360deg; }\n}`
      const { doc } = parseCssToDoc(css)
      expect(doc!.layers).toHaveLength(1)
      expect(doc!.layers[0].name).toBe('solo')
      expect(doc!.layers[0].tracks[0].property).toBe('rotate')
    })

    it('does not merge when any rule name lacks the -<index> suffix', () => {
      const css = `${simple}\n@keyframes kf-box-0 { from { opacity:0; } to { opacity:1; } }`
      const { doc } = parseCssToDoc(css)
      expect(doc!.layers.map((l) => l.name)).toEqual(['pulse', 'box-0'])
    })

    it('groups multiple bases in first-appearance order', () => {
      const css =
        `@keyframes kf-a-0 {\n  0% { opacity:0; }\n  100% { opacity:1; }\n}\n` +
        `@keyframes kf-b-0 {\n  0% { rotate:0deg; }\n  100% { rotate:90deg; }\n}\n` +
        `@keyframes kf-a-1 {\n  0% { scale:1; }\n  100% { scale:2; }\n}`
      const { doc } = parseCssToDoc(css)
      expect(doc!.layers.map((l) => l.name)).toEqual(['a', 'b'])
      const a = doc!.layers[0]
      expect(a.tracks.map((t) => t.property)).toEqual(['opacity', 'scale'])
    })
  })
})

describe('cssImport — individual-property value normalization', () => {
  it('normalizes legacy function-syntax rotate values to bare angles', () => {
    // Legacy exports emitted invalid `rotate:rotate(...)` declarations;
    // importing one should still produce a doc that re-exports valid CSS.
    const css = `@keyframes spin { from { rotate: rotate(0deg); } to { rotate: rotate(360deg); } }`
    const { doc } = parseCssToDoc(css)
    const track = doc!.layers[0].tracks.find((t) => t.property === 'rotate')!
    expect(track.keyframes.map((k) => k.value)).toEqual(['0deg', '360deg'])
  })

  it('keeps already-valid bare-angle values untouched', () => {
    const css = `@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }`
    const { doc } = parseCssToDoc(css)
    const track = doc!.layers[0].tracks.find((t) => t.property === 'rotate')!
    expect(track.keyframes.map((k) => k.value)).toEqual(['0deg', '360deg'])
  })
})
