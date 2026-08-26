import { describe, it, expect } from 'vitest'
import {
  parseTransformStack,
  addTransformFn,
  removeTransformFn,
  moveTransformFn,
  setTransformFnArgs,
  prependTransformFns,
  applyGizmoPoseToStack,
  isGizmoWritableStack,
  GIZMO_WRITABLE_FN_NAMES,
  ADDABLE_TRANSFORM_FNS,
  type StackPose,
} from './transformStack'

describe('parseTransformStack', () => {
  it('parses multi-function values', () => {
    expect(parseTransformStack('translateX(40px) rotate(45deg)')).toEqual([
      { name: 'translateX', args: '40px' },
      { name: 'rotate', args: '45deg' },
    ])
  })

  it('parses multi-arg functions and normalizes whitespace', () => {
    expect(parseTransformStack('translate(10px ,  20px) scale(2)')).toEqual([
      { name: 'translate', args: '10px ,  20px' },
      { name: 'scale', args: '2' },
    ])
  })

  it('returns empty for none/garbage', () => {
    expect(parseTransformStack('none')).toEqual([])
    expect(parseTransformStack('')).toEqual([])
  })
})

describe('addTransformFn', () => {
  it('appends with default args to an existing stack', () => {
    expect(addTransformFn('translateX(40px)', 'rotate')).toBe('translateX(40px) rotate(0deg)')
  })

  it('replaces none with the first function', () => {
    expect(addTransformFn('none', 'scale')).toBe('scale(1)')
  })

  it('ignores unknown function names', () => {
    expect(addTransformFn('scale(1)', 'frobnicate')).toBe('scale(1)')
  })

  it('every addable name has default args (by construction)', () => {
    for (const name of ADDABLE_TRANSFORM_FNS) {
      expect(addTransformFn('none', name)).toContain(`${name}(`)
    }
  })
})

describe('removeTransformFn', () => {
  it('removes by index and keeps others', () => {
    const v = 'translateX(40px) rotate(45deg) scale(2)'
    expect(removeTransformFn(v, 1)).toBe('translateX(40px) scale(2)')
  })

  it('returns none when the last function is removed', () => {
    expect(removeTransformFn('rotate(10deg)', 0)).toBe('none')
  })

  it('is a no-op for out-of-range indices', () => {
    expect(removeTransformFn('scale(1)', 5)).toBe('scale(1)')
  })
})

describe('moveTransformFn', () => {
  const v = 'a(1px) b(2px) c(3px)'

  it('moves left', () => {
    expect(moveTransformFn(v, 1, -1)).toBe('b(2px) a(1px) c(3px)')
  })

  it('moves right', () => {
    expect(moveTransformFn(v, 1, 1)).toBe('a(1px) c(3px) b(2px)')
  })

  it('clamps at both ends', () => {
    expect(moveTransformFn(v, 0, -1)).toBe(v)
    expect(moveTransformFn(v, 2, 1)).toBe(v)
  })
})

// ── Phase 3: gizmo stack surgery ────────────────────────────────────────

describe('setTransformFnArgs', () => {
  it('replaces args of the Nth function in place', () => {
    expect(setTransformFnArgs('translateX(40px) rotate(45deg)', 0, '55px')).toBe(
      'translateX(55px) rotate(45deg)',
    )
  })

  it('preserves every other byte of the surrounding stack', () => {
    const v = 'translateX(   40px )   rotate( 45DEG ) scale( 2 )'
    expect(setTransformFnArgs(v, 1, '90rad')).toBe(
      'translateX(   40px )   rotate(90rad) scale( 2 )',
    )
  })

  it('targets the Nth occurrence when a fn repeats', () => {
    expect(setTransformFnArgs('translateX(1px) rotate(2deg) translateX(3px)', 2, '9px')).toBe(
      'translateX(1px) rotate(2deg) translateX(9px)',
    )
  })

  it('is a no-op for out-of-range indices', () => {
    expect(setTransformFnArgs('scale(2)', -1, '9')).toBe('scale(2)')
    expect(setTransformFnArgs('scale(2)', 5, '9')).toBe('scale(2)')
  })

  it('is a no-op for none/empty/garbage without spans', () => {
    expect(setTransformFnArgs('none', 0, '9')).toBe('none')
    expect(setTransformFnArgs('', 0, '9')).toBe('')
    expect(setTransformFnArgs('junk text', 0, '9')).toBe('junk text')
  })
})

describe('prependTransformFns', () => {
  it('keeps the given order with names[0] leftmost', () => {
    expect(prependTransformFns('rotate(45deg)', ['translateX', 'translateY'])).toBe(
      'translateX(0px) translateY(0px) rotate(45deg)',
    )
  })

  it('turns none/empty into just the inserted fns', () => {
    expect(prependTransformFns('none', ['rotate'])).toBe('rotate(0deg)')
    expect(prependTransformFns('', ['scale'])).toBe('scale(1)')
  })

  it('skips unknown names and returns input unchanged for empty selection', () => {
    expect(prependTransformFns('scale(2)', ['frobnicate'])).toBe('scale(2)')
    expect(prependTransformFns('scale(2)', [])).toBe('scale(2)')
  })

  it('prepends before an existing stack verbatim (spacing untouched)', () => {
    expect(prependTransformFns('  rotate(   45deg )', ['scaleY'])).toContain('scaleY(1)')
    expect(prependTransformFns('rotate(45deg)', ['scaleY']).endsWith('rotate(45deg)')).toBe(true)
  })
})

// ── Phase 3: writability classifier ────────────────────────────────────

const pose = (tx: number, ty: number, rotDeg: number, scale: number): StackPose => ({
  tx,
  ty,
  rotDeg,
  scale,
})

describe('isGizmoWritableStack', () => {
  it('accepts stacks made only of writable functions', () => {
    expect(isGizmoWritableStack('translateX(40px)').writable).toBe(true)
    expect(
      isGizmoWritableStack('translateX(40px) translateY(-10%) rotate(45deg) scaleY(2)').writable,
    ).toBe(true)
    expect(isGizmoWritableStack('scale(1.5, 0.5)').writable).toBe(true)
  })

  it('rejects the two-arg translate() shorthand (not in the approved set)', () => {
    const r = isGizmoWritableStack('translate(10px , 20px)')
    expect(r.writable).toBe(false)
    expect(r.reason).toBe('non-mappable-fn')
    expect(r.fnName).toBe('translate')
  })

  it('accepts empty / none values trivially (drags insert at front)', () => {
    expect(isGizmoWritableStack('').writable).toBe(true)
    expect(isGizmoWritableStack('none').writable).toBe(true)
    expect(isGizmoWritableStack('  NONE  ').writable).toBe(true)
  })

  it('matches names case-insensitively', () => {
    expect(isGizmoWritableStack('TRANSLATEX(40PX)').writable).toBe(true)
    expect(isGizmoWritableStack('Rotate(4.5e1deg) ScaleX(2)').writable).toBe(true)
  })

  it.each([
    'skew(10deg)',
    'skewX(10deg)',
    'skewY(10deg)',
    'perspective(100px)',
    'matrix(1,0,0,1,0,0)',
    'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)',
    'rotateX(45deg)',
    'rotateY(45deg)',
    'rotateZ(45deg)',
    'frobnicate(1)',
    'translateX(40px) perspective(100px)',
    'rotate(45deg) skewY(10deg) scale(2)',
  ])('rejects non-mappable functions: %s', (v) => {
    const r = isGizmoWritableStack(v)
    expect(r.writable).toBe(false)
    expect(r.reason).toBe('non-mappable-fn')
    expect(r.fnName).toBeTruthy()
  })

  it('reports the first offending function name as written', () => {
    expect(isGizmoWritableStack('translateX(1px) SkewX(2deg)').fnName).toBe('SkewX')
  })

  it.each(['junk text', 'translateX(40px) junk', 'translateX(40px)junk'])(
    'rejects strict-syntax violations as unparseable: %s',
    (v) => {
      const r = isGizmoWritableStack(v)
      expect(r.writable).toBe(false)
      expect(r.reason).toBe('unparseable')
    },
  )

  it('exposes exactly the approved writable set', () => {
    expect([...GIZMO_WRITABLE_FN_NAMES].sort()).toEqual(
      ['rotate', 'scale', 'scalex', 'scaley', 'translatex', 'translatey'].sort(),
    )
  })
})

// ── Phase 3: write-path planning ───────────────────────────────────────

const DIMS = { width: 200, height: 100 }

describe('applyGizmoPoseToStack — translation channels', () => {
  it('accumulates ty into an existing translateY arg', () => {
    expect(
      applyGizmoPoseToStack('translateY(40px)', pose(0, 40, 0, 1), pose(0, 55, 0, 1), DIMS),
    ).toBe('translateY(55px)')
  })

  it('inserts missing translate axes at the FRONT, translate before others', () => {
    expect(
      applyGizmoPoseToStack('rotate(45deg)', pose(0, 0, 45, 1), pose(-10.5, 5, 45, 1), DIMS),
    ).toBe('translateX(-10.5px) translateY(5px) rotate(45deg)')
    expect(applyGizmoPoseToStack('rotate(45deg)', pose(0, 0, 45, 1), pose(0, 5, 45, 1), DIMS)).toBe(
      'translateY(5px) rotate(45deg)',
    )
  })

  it('rewrites both slots of a dual-arg translate() on a move (defensive: gated out by the classifier)', () => {
    expect(
      applyGizmoPoseToStack('translate(10px, 20px)', pose(10, 20, 0, 1), pose(15, 18, 0, 1), DIMS),
    ).toBe('translate(15px, 18px)')
  })

  it('edits only the FIRST same-channel contributor; later ones stay verbatim', () => {
    const v = 'translateX(40px) rotate(10deg) translateX(6px)'
    // tx total = 46; +4 → first carrier becomes 44, second stays 6.
    expect(applyGizmoPoseToStack(v, pose(46, 0, 10, 1), pose(50, 0, 10, 1), DIMS)).toBe(
      'translateX(44px) rotate(10deg) translateX(6px)',
    )
  })

  it('preserves non-edited bytes including odd whitespace and casing', () => {
    const v = 'translateY(   40px )   ROTATE(45deg)'
    // Edited arg normalizes to canonical px; the rest of the stack is verbatim.
    expect(applyGizmoPoseToStack(v, pose(0, 40, 45, 1), pose(7, 42, 45, 1), DIMS)).toBe(
      'translateX(7px) translateY(42px)   ROTATE(45deg)',
    )
  })
})

describe('applyGizmoPoseToStack — rotation channel', () => {
  it('sums degrees into an existing rotate()', () => {
    expect(applyGizmoPoseToStack('rotate(45deg)', pose(0, 0, 45, 1), pose(0, 0, 60, 1), DIMS)).toBe(
      'rotate(60deg)',
    )
  })

  it('normalizes rad/turn args to deg on edit (documented bake)', () => {
    expect(
      applyGizmoPoseToStack('rotate(0.25turn)', pose(0, 0, 90, 1), pose(0, 0, 100, 1), DIMS),
    ).toBe('rotate(100deg)')
  })

  it('inserts rotate at the front when absent', () => {
    expect(
      applyGizmoPoseToStack('translateY(10px)', pose(0, 10, 0, 1), pose(0, 10, -30, 1), DIMS),
    ).toBe('rotate(-30deg) translateY(10px)')
  })

  it('handles negative angles and >360 wraps via plain deg accumulation', () => {
    expect(
      applyGizmoPoseToStack('rotate(-370deg)', pose(0, 0, -370, 1), pose(0, 0, -355, 1), DIMS),
    ).toBe('rotate(-355deg)')
  })
})

describe('applyGizmoPoseToStack — scale channel', () => {
  it('multiplies into scale(a) once (shared slot carries both axes)', () => {
    expect(applyGizmoPoseToStack('scale(2)', pose(0, 0, 0, 2), pose(0, 0, 0, 3), DIMS)).toBe(
      'scale(3)',
    )
  })

  it('multiplies each arg of scale(a, b)', () => {
    expect(applyGizmoPoseToStack('scale(2, 3)', pose(0, 0, 0, 3), pose(0, 0, 0, 4.5), DIMS)).toBe(
      'scale(3, 4.5)',
    )
  })

  it('multiplies scaleX/scaleY carriers per axis', () => {
    expect(
      applyGizmoPoseToStack('scaleX(2) scaleY(3)', pose(0, 0, 0, 3), pose(0, 0, 0, 6), DIMS),
    ).toBe('scaleX(4) scaleY(6)')
  })

  it('inserts a missing scale axis at the front (uniform mul covers both)', () => {
    expect(applyGizmoPoseToStack('scaleX(2)', pose(0, 0, 0, 2), pose(0, 0, 0, 4), DIMS)).toBe(
      'scaleY(2) scaleX(4)',
    )
  })

  it('inserts one scale() when the stack had no scale family at all', () => {
    expect(
      applyGizmoPoseToStack('rotate(10deg)', pose(0, 0, 10, 1), pose(0, 0, 10, 1.25), DIMS),
    ).toBe('scale(1.25) rotate(10deg)')
  })
})

describe('applyGizmoPoseToStack — percent bake & canonical units', () => {
  it('bakes % X against width captured at drag start (owner decision 4)', () => {
    expect(
      applyGizmoPoseToStack('translateX(50%)', pose(100, 0, 0, 1), pose(130, 0, 0, 1), DIMS),
    ).toBe('translateX(130px)')
  })

  it('bakes % Y against height', () => {
    expect(
      applyGizmoPoseToStack('translateY(25%)', pose(0, 25, 0, 1), pose(0, 45, 0, 1), DIMS),
    ).toBe('translateY(45px)')
  })

  it('bakes % inside a dual translate() while the untouched axis keeps its unit', () => {
    expect(
      applyGizmoPoseToStack('translate(50%, 25%)', pose(100, 25, 0, 1), pose(120, 25, 0, 1), DIMS),
    ).toBe('translate(120px, 25%)')
  })

  it('negative and >100% percentages bake to negative/large px', () => {
    expect(
      applyGizmoPoseToStack('translateX(-150%)', pose(-300, 0, 0, 1), pose(-290, 0, 0, 1), DIMS),
    ).toBe('translateX(-290px)')
  })

  it('% without dims bakes from a 0 baseline (pose-model parity)', () => {
    expect(applyGizmoPoseToStack('translateX(50%)', pose(0, 0, 0, 1), pose(12, 0, 0, 1))).toBe(
      'translateX(12px)',
    )
  })

  it('round-trips: write → parse → write is stable', () => {
    // parseCompositeTransform semantics replicated inline: px sums, deg
    // sums, uniform scale multiplies — the planner's own contract.
    const v = 'translateX(50%) rotate(0.25turn) scale(2)'
    const dims = DIMS
    // drag-start pose of `v`
    const p0 = pose(100, 0, 90, 2)
    const t1 = pose(115, 8, 120, 2.5)
    const w1 = applyGizmoPoseToStack(v, p0, t1, dims)
    // translateY had no carrier in v → inserted at the FRONT.
    expect(w1).toBe('translateY(8px) translateX(115px) rotate(120deg) scale(2.5)')
    // Re-parse w1 under the same model and re-write with zero delta → stable bytes.
    const w2 = applyGizmoPoseToStack(w1, t1, pose(115, 8, 120, 2.5), dims)
    expect(w2).toBe(w1)
    // A second real delta accumulates from the written string cleanly —
    // every channel now has a carrier, so edits stay exactly in place.
    const w3 = applyGizmoPoseToStack(w1, t1, pose(125, -2, 150, 5), dims)
    expect(w3).toBe('translateY(-2px) translateX(125px) rotate(150deg) scale(5)')
  })
})

describe('applyGizmoPoseToStack — defensive totals', () => {
  it('identity deltas return the input byte-for-byte', () => {
    const v = 'translateX(   40px )   ROTATE(45deg)'
    expect(applyGizmoPoseToStack(v, pose(40, 0, 45, 1), pose(40, 0, 45, 1), DIMS)).toBe(v)
  })

  it('unparseable inputs are returned untouched', () => {
    expect(applyGizmoPoseToStack('junk text', pose(0, 0, 0, 1), pose(5, 0, 0, 1), DIMS)).toBe(
      'junk text',
    )
    expect(
      applyGizmoPoseToStack('translateX(40px) junk', pose(40, 0, 0, 1), pose(45, 0, 0, 1), DIMS),
    ).toBe('translateX(40px) junk')
  })

  it("'none'/empty start values grow fresh front-insertions", () => {
    expect(applyGizmoPoseToStack('none', pose(0, 0, 0, 1), pose(5, -3, 15, 1), DIMS)).toBe(
      'translateX(5px) translateY(-3px) rotate(15deg)',
    )
    expect(applyGizmoPoseToStack('', pose(0, 0, 0, 1), pose(0, 0, 0, 1.25), DIMS)).toBe(
      'scale(1.25)',
    )
  })

  it('zero-scale start poses do not explode the multiplier', () => {
    expect(applyGizmoPoseToStack('scale(0)', pose(0, 0, 0, 0), pose(0, 0, 0, 0), DIMS)).toBe(
      'scale(0)',
    )
  })

  it('uppercase function names keep their exact serialization on edit', () => {
    expect(applyGizmoPoseToStack('ROTATE(45deg)', pose(0, 0, 45, 1), pose(0, 0, 60, 1), DIMS)).toBe(
      'ROTATE(60deg)',
    )
  })

  it('nested/odd inner whitespace normalizes ONLY within edited args', () => {
    expect(
      applyGizmoPoseToStack('translateX(  40px   )', pose(40, 0, 0, 1), pose(41, 0, 0, 1), DIMS),
    ).toBe('translateX(41px)')
  })
})
