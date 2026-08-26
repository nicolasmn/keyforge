import { describe, it, expect, beforeEach } from 'vitest'
import {
  doc,
  setDoc,
  addLayer,
  addTrack,
  addKeyframe,
  updateKeyframe,
  removeKeyframe,
  applyGizmoEdit,
} from '@/store'
import { parseCompositeTransform } from '@/utils/gizmoMath'
import { applyGizmoPoseToStack, isGizmoWritableStack, type StackPose } from '@/utils/transformStack'
import type { AnimationDocument } from '@/types'
import { nanoid } from '@/utils/nanoid'

/**
 * Store-level integration test for Phase-3 composite-stack gizmo writes.
 *
 * Reproduces the overlay's EXACT call sequence for a fully-mappable
 * composite-only layer — parse the drag-start pose off the transform track
 * (dims-resolved), plan a new stack string via transformStack surgery, and
 * commit it through applyGizmoEdit('transform', …) — then exercises the
 * receipt-driven Esc-cancel reversal on top of real store state. The DOM
 * pointerdown wiring is verified separately in-browser; everything below
 * runs in node against the actual store module.
 */

const blankDoc = (): AnimationDocument => ({
  id: nanoid(),
  name: 'Test',
  duration: 1000,
  layers: [],
})

const BOX = { width: 200, height: 100 }

/** Composite-only layer fixture: translateY keys at 0ms / 1000ms. */
function seedCompositeLayer(): { layerId: string; trackId: string } {
  addLayer()
  const layerId = doc.layers[0].id
  const trackId = addTrack(layerId, 'transform') as string
  addKeyframe(layerId, trackId, { time: 0, value: 'translateY(40px)', easing: 'ease-out' })
  addKeyframe(layerId, trackId, {
    time: 1000,
    value: 'translateY(120px) rotate(45deg)',
    easing: 'ease-out',
  })
  return { layerId, trackId }
}

const pose = (tx: number, ty: number, rotDeg: number, scale: number): StackPose => ({
  tx,
  ty,
  rotDeg,
  scale,
})

beforeEach(() => {
  setDoc(blankDoc())
})

describe('composite-only gizmo drag → transform-track write', () => {
  it('creates a keyframe on the transform track at the playhead', () => {
    const { layerId, trackId } = seedCompositeLayer()
    const startValue = 'translateY(40px)' // interpolatedValueAt(track, 400) → hold-first

    // ── overlay call path: parse → plan → applyGizmoEdit ──
    const start = parseCompositeTransform(startValue, BOX)
    expect(start).not.toBeNull()
    const target = { ...start!, tx: start!.tx + 12, ty: start!.ty + 8 }
    const planned = applyGizmoPoseToStack(startValue, start!, target, BOX)
    expect(planned).toBe('translateX(12px) translateY(48px)')

    const receipt = applyGizmoEdit(layerId, 'transform', 400, planned)
    expect(receipt).not.toBeNull()
    expect(receipt!.kind).toBe('create-kf')
    expect(receipt!.trackId).toBe(trackId)

    const track = doc.layers.find((l) => l.id === layerId)!.tracks.find((t) => t.id === trackId)!
    expect(track.keyframes).toHaveLength(3)
    const created = track.keyframes.find((k) => k.id === receipt!.kfId)!
    expect(created.time).toBe(400)
    expect(created.value).toBe(planned)

    // The written stack parses back to the TARGET pose under the same dims:
    // the preview shows exactly what the drag asked for.
    const reparsed = parseCompositeTransform(created.value, BOX)
    expect(reparsed!.tx).toBeCloseTo(target.tx, 6)
    expect(reparsed!.ty).toBeCloseTo(target.ty, 6)
    expect(reparsed!.rotDeg).toBeCloseTo(0, 6)
    expect(reparsed!.scale).toBeCloseTo(1, 6)
  })

  it('updates the keyframe value when the playhead sits exactly on one', () => {
    const { layerId, trackId } = seedCompositeLayer() // kf at 0ms holds translateY(40px)
    const start = parseCompositeTransform('translateY(40px)', BOX)!
    const planned = applyGizmoPoseToStack('translateY(40px)', start, { ...start, rotDeg: 30 }, BOX)
    expect(planned).toBe('rotate(30deg) translateY(40px)')

    const originalValue = 'translateY(40px)'
    const receipt = applyGizmoEdit(layerId, 'transform', 0, planned)
    expect(receipt).not.toBeNull()
    expect(receipt!.kind).toBe('update-kf')
    expect(receipt!.originalValue).toBe(originalValue)

    const track = doc.layers.find((l) => l.id === layerId)!.tracks.find((t) => t.id === trackId)!
    expect(track.keyframes.find((k) => k.time === 0)!.value).toBe(planned)
  })

  it('streams multiple drag frames onto the SAME created keyframe (auto-key burst)', () => {
    const { layerId, trackId } = seedCompositeLayer()
    // Frame 1 creates; frames 2+ hit the ±8ms epsilon → update-kf.
    const r1 = applyGizmoEdit(layerId, 'transform', 400, 'translateX(4px)')
    expect(r1!.kind).toBe('create-kf')
    const r2 = applyGizmoEdit(layerId, 'transform', 405, 'translateX(9px)')
    expect(r2!.kind).toBe('update-kf')
    expect(r2!.kfId).toBe(r1!.kfId)

    const track = doc.layers.find((l) => l.id === layerId)!.tracks.find((t) => t.id === trackId)!
    expect(track.keyframes.filter((k) => k.time === 400)).toHaveLength(1)
  })

  it('Esc-cancel reversal restores pre-drag store state structurally', () => {
    const { layerId, trackId } = seedCompositeLayer()

    // CREATE case: cancel removes the created keyframe.
    const createReceipt = applyGizmoEdit(layerId, 'transform', 400, 'translateX(12px)')
    expect(createReceipt!.kind).toBe('create-kf')
    removeKeyframe(layerId, createReceipt!.trackId, createReceipt!.kfId!)
    let track = doc.layers.find((l) => l.id === layerId)!.tracks.find((t) => t.id === trackId)!
    expect(track.keyframes.map((k) => k.time)).toEqual([0, 1000])

    // UPDATE case: cancel rewrites the original value back.
    const updateReceipt = applyGizmoEdit(layerId, 'transform', 0, 'rotate(90deg) scale(3)')
    expect(updateReceipt!.kind).toBe('update-kf')
    updateKeyframe(layerId, updateReceipt!.trackId, updateReceipt!.kfId!, {
      value: updateReceipt!.originalValue!,
    })
    track = doc.layers.find((l) => l.id === layerId)!.tracks.find((t) => t.id === trackId)!
    expect(track.keyframes.find((k) => k.time === 0)!.value).toBe('translateY(40px)')
  })

  it('mixed layers keep writing individual tracks (decision 3 preserved)', () => {
    addLayer()
    const layerId = doc.layers[0].id
    addTrack(layerId, 'transform')
    addTrack(layerId, 'translate')
    // Individual translate write lands on its own track, untouched stack.
    const receipt = applyGizmoEdit(layerId, 'translate', 250, '15px -5px')
    expect(receipt).not.toBeNull()
    expect(receipt!.kind).toBe('create-kf') // existing translate track gains the kf
    const layer = doc.layers.find((l) => l.id === layerId)!
    const translateTrack = layer.tracks.find((t) => t.property === 'translate')!
    expect(translateTrack.keyframes[0].value).toBe('15px -5px')
    const transformTrack = layer.tracks.find((t) => t.property === 'transform')!
    expect(transformTrack.keyframes).toHaveLength(0) // composite frozen
  })

  it('gate math: every-value writability decides live vs readonly fixtures', () => {
    // Mirrors the overlay's compositeGate predicate for these fixtures.
    const liveValues = ['translateY(40px)', 'translateX(10px) rotate(-30deg) scale(2)']
    const readonlyValues = ['skewX(20deg)', 'translate(40px, 10px)', 'perspective(500px)']
    for (const v of liveValues) {
      expect(isGizmoWritableStack(v).writable).toBe(true)
      expect(parseCompositeTransform(v, BOX)).not.toBeNull()
    }
    for (const v of readonlyValues) {
      const writable = isGizmoWritableStack(v).writable && parseCompositeTransform(v, BOX) !== null
      expect(writable).toBe(false)
    }
  })

  it('percent-bake: drag-start % resolves once against frozen dims, writes px', () => {
    const { layerId } = seedCompositeLayer()
    // Rewrite kf@0 to a %-valued stack first (as an author would).
    const track = doc.layers
      .find((l) => l.id === layerId)!
      .tracks.find((t) => t.property === 'transform')!
    updateKeyframe(layerId, track.id, track.keyframes[0].id, { value: 'translateX(50%)' })

    // Overlay call path with frozen BOX dims at grab:
    const start = parseCompositeTransform('translateX(50%)', BOX)! // 100px
    const planned = applyGizmoPoseToStack('translateX(50%)', start, { ...start, tx: 130 }, BOX)
    expect(planned).toBe('translateX(130px)')

    const receipt = applyGizmoEdit(layerId, 'transform', 300, planned)
    expect(receipt!.kind).toBe('create-kf')
    // Re-parse WITHOUT dims now: baked px is self-contained.
    const written = doc.layers
      .find((l) => l.id === layerId)!
      .tracks.find((t) => t.property === 'transform')!
      .keyframes.find((k) => k.id === receipt!.kfId)!
    expect(written.value).toBe('translateX(130px)')
    expect(parseCompositeTransform(written.value)!.tx).toBe(130)
  })

  it('planner + classifier stay consistent on gate-passing values (round-trip stability)', () => {
    const { layerId } = seedCompositeLayer()
    const startValue = 'translateY(120px) rotate(45deg)'
    let current = startValue
    let currentPose = parseCompositeTransform(current, BOX)!
    // Simulate three consecutive drag frames accumulating deltas.
    const steps: Array<[StackPose, StackPose]> = [
      [currentPose, pose(5, 125, 45, 1)],
      [pose(5, 125, 45, 1), pose(5, 125, 60, 1.5)],
      [pose(5, 125, 60, 1.5), pose(25, 105, 60, 1.5)],
    ]
    for (const [from, to] of steps) {
      current = applyGizmoPoseToStack(current, from, to, BOX)
      expect(isGizmoWritableStack(current).writable).toBe(true) // still editable
      const parsed = parseCompositeTransform(current, BOX)!
      expect(parsed.tx).toBeCloseTo(to.tx, 1)
      expect(parsed.ty).toBeCloseTo(to.ty, 1)
      expect(parsed.rotDeg).toBeCloseTo(to.rotDeg, 1)
      expect(parsed.scale).toBeCloseTo(to.scale, 1)
      currentPose = to
    }
    // Committing the final frame lands exactly one new keyframe at 700ms.
    const receipt = applyGizmoEdit(layerId, 'transform', 700, current)
    expect(receipt!.kind).toBe('create-kf')
    const track = doc.layers
      .find((l) => l.id === layerId)!
      .tracks.find((t) => t.property === 'transform')!
    expect(track.keyframes.find((k) => k.id === receipt!.kfId)!.value).toBe(current)
  })
})
