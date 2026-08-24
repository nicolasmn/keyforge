import { describe, it, expect } from 'vitest'
import { tokenizeLayer } from './tokenize'
import type { AnimationDocument, Layer } from '@/types'

function makeLayer(
  value: string,
  property: Layer['tracks'][number]['property'] = 'transform',
): Layer {
  return {
    id: 'L1',
    name: 'test layer',
    visible: true,
    element: { tag: 'div', initialCss: '' },
    tracks: [
      {
        id: 'T1',
        property,
        keyframes: [{ id: 'KF1', time: 0, value, easing: 'linear' }],
      },
    ],
  }
}

function makeDoc(layer: Layer): AnimationDocument {
  return { id: 'D1', name: 'doc', duration: 1000, layers: [layer] }
}

const valueTokenOf = (layer: Layer) =>
  tokenizeLayer(layer, makeDoc(layer)).find((t) => t.path.field === 'value')!

describe('tokenizeLayer — transform sub-tokens', () => {
  it('produces one sub-token per numeric arg, single function', () => {
    const t = valueTokenOf(makeLayer('translateX(40px)'))
    expect(t.type).toBe('transform')
    expect(t.subTokens).toHaveLength(1)
    const st = t.subTokens![0]
    expect(st.value).toBe('40')
    expect(st.unit).toBe('px')
    expect(st.argIndex).toBe(0)
  })

  it('encodes multi-function args as fnIndex * 100 + argInFn', () => {
    const t = valueTokenOf(makeLayer('translateX(40px) rotate(45deg)'))
    const [a, b] = t.subTokens!
    expect(a.argIndex).toBe(0) // fn 0, arg 0
    expect(b.argIndex).toBe(100) // fn 1, arg 0
    expect(b.unit).toBe('deg')
  })

  it('assembler round-trips an untouched multi-function value', () => {
    const value = 'translateX(40px) rotate(45deg)'
    const t = valueTokenOf(makeLayer(value))
    expect(t.subTokens![0].assembler(t.subTokens!)).toBe(value)
  })

  it('assembler applies edits only to the targeted function', () => {
    const t = valueTokenOf(makeLayer('translateX(40px) rotate(45deg)'))
    const edited = t.subTokens!.map((st) => (st.argIndex === 100 ? { ...st, value: '90' } : st))
    expect(t.subTokens![0].assembler(edited)).toBe('translateX(40px) rotate(90deg)')
    // and editing fn0 leaves fn1 alone
    const editFirst = t.subTokens!.map((st) =>
      st.argIndex === 0 ? { ...st, value: '-10', unit: '%' } : st,
    )
    expect(t.subTokens![0].assembler(editFirst)).toBe('translateX(-10%) rotate(45deg)')
  })

  it('falls back to the original arg text when a sub-token is missing', () => {
    // Simulate a lost sub-token by passing an empty list to the assembler.
    const t = valueTokenOf(makeLayer('translateX(40px) rotate(45deg)'))
    expect(t.subTokens![0].assembler([])).toBe('translateX(40px) rotate(45deg)')
  })

  it('skips non-numeric args without corrupting argIndex encoding', () => {
    // matrix() with a non-numeric arg would be unusual, so use a mixed
    // custom case: second function has a non-numeric first arg.
    const value = 'scale(2) translateX(40px)'
    const t = valueTokenOf(makeLayer(value))
    expect(t.subTokens!.map((s) => s.argIndex)).toEqual([0, 100])
    expect(t.subTokens![0].assembler(t.subTokens!)).toBe(value)
  })

  it('handles multi-arg functions and preserves comma spacing on rebuild', () => {
    const value = 'translate(40px, 10px)'
    const t = valueTokenOf(makeLayer(value))
    expect(t.subTokens!.map((s) => s.argIndex)).toEqual([0, 1])
    expect(t.subTokens![0].assembler(t.subTokens!)).toBe('translate(40px, 10px)')
  })
})

describe('tokenizeLayer — property-first classification (delete-all dead end)', () => {
  // Regression: deleting every function from a transform track serializes to
  // the literal value 'none'. Text-based detection misclassified it as
  // 'string', which hid the Inspector's transform branch (sub-chips +
  // stack-picker add button) — an unrecoverable UI dead end. Classification
  // keys off track.property FIRST; the value text is irrelevant for this type.
  it("types 'none' on a transform track as transform with zero sub-tokens", () => {
    const t = valueTokenOf(makeLayer('none'))
    expect(t.type).toBe('transform')
    expect(t.subTokens).toEqual([])
    expect(t.value).toBe('none')
  })

  it('opens the Inspector transform gate for "none" (type is now the whole gate)', () => {
    // ValueChip renders the picker when token.type === 'transform'; the old
    // gate additionally required subTokens.length > 0, which this pins open.
    const t = valueTokenOf(makeLayer('none'))
    expect(t.type === 'transform').toBe(true)
  })

  it('tolerates an empty value defensively (store rejects empties, tokenizer must not crash)', () => {
    const t = valueTokenOf(makeLayer(''))
    expect(t.type).toBe('transform')
    expect(t.subTokens).toEqual([])
  })

  it('leaves non-transform tracks classifying by value text', () => {
    expect(valueTokenOf(makeLayer('42', 'opacity')).type).toBe('number')
    expect(valueTokenOf(makeLayer('#ff8800', 'background-color')).type).toBe('color')
    // Individual-property tracks keep text detection: fn-shaped legacy values
    // still classify as transform there, bare numbers stay numeric.
    expect(valueTokenOf(makeLayer('translate(0px, 0px)', 'translate')).type).toBe('transform')
    expect(valueTokenOf(makeLayer('45deg', 'rotate')).type).toBe('number')
  })

  it('still types populated stacks on transform tracks normally', () => {
    const t = valueTokenOf(makeLayer('scale(2)'))
    expect(t.type).toBe('transform')
    expect(t.subTokens).toHaveLength(1)
    expect(t.subTokens![0].assembler(t.subTokens!)).toBe('scale(2)')
  })
})

describe('tokenizeLayer — paths and ordering', () => {
  it('maps tokens to the right layer/track/keyframe/field', () => {
    const layer = makeLayer('42')
    const tokens = tokenizeLayer(layer, makeDoc(layer))
    expect(tokens.map((t) => t.path.field)).toEqual(['value', 'easing'])
    for (const t of tokens) {
      expect(t.path.layerId).toBe('L1')
      expect(t.path.trackId).toBe('T1')
      expect(t.path.keyframeId).toBe('KF1')
    }
  })

  it('emits value then easing per keyframe, in track order', () => {
    const layer = makeLayer('42')
    layer.tracks.push({
      id: 'T2',
      property: 'opacity',
      keyframes: [{ id: 'KF2', time: 500, value: '0.5', easing: 'ease-in' }],
    })
    const tokens = tokenizeLayer(layer, makeDoc(layer))
    expect(tokens.map((t) => `${t.path.trackId}:${t.path.field}`)).toEqual([
      'T1:value',
      'T1:easing',
      'T2:value',
      'T2:easing',
    ])
    expect(tokens[2].value).toBe('0.5')
    expect(tokens[3].value).toBe('ease-in')
  })
})
