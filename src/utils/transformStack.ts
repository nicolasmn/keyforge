/**
 * Pure string operations for composing transform function stacks.
 *
 * Transform values are flat strings ("translateX(40px) rotate(45deg)").
 * These utilities parse, mutate, and re-serialize them so the Inspector's
 * stack UI can add/remove/reorder functions with one string commit per
 * operation (undo-friendly via the single write path).
 */

export interface ParsedTransformFn {
  name: string
  /** Raw argument text between parens (trimmed; '' for no-arg fns). */
  args: string
}

const FN_RE = /([\w-]+)\(([^)]*)\)/g

export function parseTransformStack(value: string): ParsedTransformFn[] {
  const out: ParsedTransformFn[] = []
  FN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FN_RE.exec(value))) {
    out.push({ name: m[1], args: m[2].trim() })
  }
  return out
}

function serialize(stack: ParsedTransformFn[]): string {
  if (stack.length === 0) return 'none'
  return stack.map((f) => `${f.name}(${f.args})`).join(' ')
}

/** Sensible default args when a function is added fresh. */
const DEFAULT_ARGS: Record<string, string> = {
  translate: '0px, 0px',
  translateX: '0px',
  translateY: '0px',
  translateZ: '0px',
  scale: '1',
  scaleX: '1',
  scaleY: '1',
  rotate: '0deg',
  rotateX: '0deg',
  rotateY: '0deg',
  rotateZ: '0deg',
  skew: '0deg, 0deg',
  skewX: '0deg',
  skewY: '0deg',
}

export const ADDABLE_TRANSFORM_FNS = Object.keys(DEFAULT_ARGS)

/** Append a function to the stack with sensible default arguments. */
export function addTransformFn(value: string, name: string): string {
  if (!DEFAULT_ARGS[name]) return value // unknown fn → unchanged
  const stack = value === 'none' || !value.trim() ? [] : parseTransformStack(value)
  stack.push({ name, args: DEFAULT_ARGS[name] })
  return serialize(stack)
}

/** Remove the function at fnIndex (same order as tokenize's encoding). */
export function removeTransformFn(value: string, fnIndex: number): string {
  const stack = parseTransformStack(value)
  if (fnIndex < 0 || fnIndex >= stack.length) return value
  stack.splice(fnIndex, 1)
  return serialize(stack)
}

/** Move the function at fnIndex by delta (-1 left, +1 right). */
export function moveTransformFn(value: string, fnIndex: number, delta: number): string {
  const stack = parseTransformStack(value)
  const to = fnIndex + delta
  if (fnIndex < 0 || fnIndex >= stack.length || to < 0 || to >= stack.length) return value
  const [fn] = stack.splice(fnIndex, 1)
  stack.splice(to, 0, fn)
  return serialize(stack)
}

// ── Gizmo write surgery (Phase 3) ────────────────────────────────────────
// Stage gizmos may map drags onto composite transform stacks whose functions
// are ALL gizmo-writable (owner-approved decisions, 2026-08-26):
//
//   1. Writable set = translateX/translateY/rotate/scale/scaleX/scaleY.
//      Missing ones are INSERTED AT THE FRONT (order among inserted:
//      translate → rotate → scale). Everything else in the stack stays
//      untouched and keeps its exact serialization.
//   2. ANY non-mappable function anywhere on the track keeps the layer
//      badge+inert — enforced by isGizmoWritableStack + the overlay gate.
//   4. Percent args bake against drag-start box dims when edited: the
//      resolved px value is WRITTEN into the stack string.

/**
 * Functions a stage-gizmo drag may edit inside a composite stack.
 * Matched case-insensitively (CSS function names are case-insensitive);
 * existing names keep their original serialization when only args change.
 */
export const GIZMO_WRITABLE_FN_NAMES: ReadonlySet<string> = new Set([
  'translatex',
  'translatey',
  'rotate',
  'scale',
  'scalex',
  'scaley',
])

/** Canonical spellings for front-inserted functions, keyed by lower name. */
const CANONICAL_INSERT_NAME: Record<string, string> = {
  translatex: 'translateX',
  translatey: 'translateY',
  rotate: 'rotate',
  scale: 'scale',
  scalex: 'scaleX',
  scaley: 'scaleY',
}

/** Insertion rank among front-inserted fns: translate → rotate → scale. */
function insertRank(lowerName: string): number {
  const order = ['translatex', 'translatey', 'rotate', 'scale', 'scalex', 'scaley']
  const idx = order.indexOf(lowerName)
  return idx === -1 ? order.length : idx
}

interface RawSpan {
  /** Function name exactly as written. */
  name: string
  nameLower: string
  /** Index of the name's first char within the scanned text. */
  start: number
  /** Raw argument text between parens (untrimmed). */
  rawArgs: string
}

/**
 * Scan `value` into raw fn(...) spans with positions preserved.
 * Strict syntax — the same contract as gizmoMath.parseCompositeTransform:
 * only whitespace may sit before/between/after spans. Returns null when the
 * text violates that (stray tokens, trailing junk), so callers never edit a
 * value they cannot fully account for byte-for-byte.
 */
function scanRawSpans(value: string): RawSpan[] | null {
  const out: RawSpan[] = []
  FN_RE.lastIndex = 0
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = FN_RE.exec(value))) {
    if (value.slice(cursor, m.index).trim() !== '') return null
    out.push({
      name: m[1] ?? '',
      nameLower: (m[1] ?? '').toLowerCase(),
      start: m.index,
      rawArgs: m[2] ?? '',
    })
    cursor = m.index + m[0].length
  }
  if (value.slice(cursor).trim() !== '') return null
  return out
}

/**
 * Set the argument text of the Nth parsed function IN PLACE.
 *
 * Only the text between that function's parens changes; its name, its
 * position, and every other byte of the surrounding stack (names, spacing,
 * other arguments) are preserved verbatim. Out-of-range indices and stacks
 * with no functions ('none', '', garbage) return the input unchanged.
 *
 * Pure string surgery — no validation of `args` contents.
 */
export function setTransformFnArgs(value: string, fnIndex: number, args: string): string {
  if (!value) return value
  const spans = scanRawSpans(value)
  if (!spans || fnIndex < 0 || fnIndex >= spans.length) return value
  const span = spans[fnIndex]
  const openParen = value.indexOf('(', span.start)
  if (openParen === -1) return value // defensive; scan guarantees it exists
  return `${value.slice(0, openParen + 1)}${args}${value.slice(openParen + 1 + span.rawArgs.length)}`
}

/**
 * Prepend functions (in the GIVEN order — names[0] ends up leftmost) with
 * their sensible default args to the front of the stack. 'none'/empty
 * values become just the inserted functions; unknown names are skipped;
 * an empty selection returns the input unchanged.
 */
export function prependTransformFns(value: string, names: readonly string[]): string {
  const fresh = names.filter((n) => DEFAULT_ARGS[n])
  const base = fresh.map((name) => `${name}(${DEFAULT_ARGS[name]})`)
  if (base.length === 0) return value
  const rest = value.trim()
  if (!rest || rest.toLowerCase() === 'none') return base.join(' ')
  return `${base.join(' ')} ${rest}`
}

// ── Gizmo-writability classifier ───────────────────────────────────────

export type GizmoStackUnwritableReason =
  /** skew / perspective / matrix / rotateX-Y-Z / unrecognized function appears. */
  | 'non-mappable-fn'
  /** Stray tokens / trailing junk make the value not a clean fn list. */
  | 'unparseable'

export interface GizmoStackWritability {
  /**
   * True when EVERY function in the stack is gizmo-writable (trivially true
   * for empty/'none' — drags then insert at the front).
   */
  writable: boolean
  reason?: GizmoStackUnwritableReason
  /** The offending function name (as written), when reason='non-mappable-fn'. */
  fnName?: string
}

/**
 * Classify whether one composite transform VALUE can be gizmo-edited:
 * strict fn-list syntax, and every function within the writable set.
 * Structural only — pose-level arg semantics (units etc.) stay owned by
 * gizmoMath.parseCompositeTransform, which callers combine this with so the
 * two never drift apart.
 */
export function isGizmoWritableStack(value: string): GizmoStackWritability {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v || v.toLowerCase() === 'none') return { writable: true }
  const spans = scanRawSpans(v)
  if (!spans || spans.length === 0) return { writable: false, reason: 'unparseable' }
  for (const s of spans) {
    if (!GIZMO_WRITABLE_FN_NAMES.has(s.nameLower)) {
      return { writable: false, reason: 'non-mappable-fn', fnName: s.name }
    }
  }
  return { writable: true }
}

// ── Write-path planning (pose deltas → new stack string) ───────────────

/**
 * The four-channel pose a gizmo gesture composes (structurally identical to
 * gizmoMath.GizmoPose; declared locally so this module stays dependency-free).
 */
export interface StackPose {
  tx: number
  ty: number
  rotDeg: number
  scale: number
}

/** Box dims used to resolve %-unit translations (translateX→width, Y→height). */
export type StackDimsLike = { width: number; height: number }

const POSE_EPSILON = 1e-9

/** Round to 3 decimals like formatScaleNum, without negative zero. */
function trimNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

/** Edited lengths/angles serialize with one decimal (formatTranslate parity). */
function fmtLen(px: number): string {
  const r = Math.round(px * 10) / 10
  return `${Object.is(r, -0) ? 0 : r}px`
}

function fmtAngle(deg: number): string {
  const r = Math.round(deg * 10) / 10
  return `${Object.is(r, -0) ? 0 : r}deg`
}

const NUM_UNIT_RE = /^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Z%]*)$/

/** Parse one `<number><unit>` token; null when the text isn't one. */
function parseNumUnit(arg: string): { n: number; unit: string } | null {
  const m = NUM_UNIT_RE.exec(arg.trim())
  if (!m || m[1] === undefined || m[2] === undefined) return null
  const n = Number.parseFloat(m[1])
  return Number.isNaN(n) ? null : { n, unit: m[2] }
}

/**
 * Length arg → px under the pose model: px direct, % against the axis
 * dimension (bake-on-edit), everything else (em/vw/…, bare numbers) reads
 * as its 0 contribution — mirroring gizmoMath.lengthArgToPx exactly.
 */
function lenArgToPx(arg: string, axisDim: number): number {
  const p = parseNumUnit(arg)
  if (!p) return 0
  const unit = p.unit.toLowerCase()
  if (unit === 'px') return p.n
  if (unit === '%' && axisDim > 0) return (p.n / 100) * axisDim
  return 0
}

const ANGLE_TO_DEG: Record<string, (n: number) => number> = {
  deg: (n) => n,
  grad: (n) => (n * 360) / 400,
  rad: (n) => (n * 180) / Math.PI,
  turn: (n) => n * 360,
}

/** Angle arg → degrees (deg/grad/rad/turn); null for anything else. */
function angleArgToDeg(arg: string): number | null {
  const p = parseNumUnit(arg)
  if (!p) return null
  const conv = ANGLE_TO_DEG[p.unit.toLowerCase()]
  return conv ? conv(p.n) : null
}

interface SlotRef {
  spanIdx: number
  /** Index into the span's comma-split arg list. */
  argIdx: number
}

/** One concrete argument rewrite: additive px/deg delta or scale multiply. */
interface SlotEdit {
  kind: 'len' | 'angle' | 'scale'
  add: number
  mul: number
  /** Axis dimension for %-baking of len edits. */
  axisDim: number
  spanIdx: number
  argIdx: number
}

function splitArgs(rawArgs: string): string[] {
  const t = rawArgs.trim()
  return t === '' ? [] : t.split(',').map((a) => a.trim())
}

/**
 * Map ONE pose edit onto the parsed stack: locate the FIRST contributor slot
 * per channel (tx/ty/rotDeg/scale-x/scale-y), rewrite its argument to carry
 * that channel's delta, and remember channels with NO carrier for
 * front-insertion.
 *
 * Deltas land on the first contributing function only; later same-channel
 * functions stay untouched, which shifts the channel total by exactly the
 * delta (contributions sum/multiply across the whole stack). A shared
 * scale(a) slot feeds both sx and sy through ONE argument, so its multiplier
 * applies once there.
 */
function planSlotEdits(
  spans: RawSpan[],
  start: StackPose,
  target: StackPose,
  dims: StackDimsLike | undefined,
): { edits: SlotEdit[]; insert: Set<string>; dTx: number; dTy: number; dRot: number; mul: number } {
  const firstSlot = (test: (s: RawSpan) => number | null): SlotRef | null => {
    for (let i = 0; i < spans.length; i++) {
      const argIdx = test(spans[i])
      if (argIdx !== null) return { spanIdx: i, argIdx }
    }
    return null
  }

  const txSlot = firstSlot((s) => {
    if (s.nameLower === 'translatex') return splitArgs(s.rawArgs).length >= 1 ? 0 : null
    if (s.nameLower === 'translate') return splitArgs(s.rawArgs).length >= 1 ? 0 : null
    return null
  })
  const tySlot = firstSlot((s) => {
    if (s.nameLower === 'translatey') return splitArgs(s.rawArgs).length >= 1 ? 0 : null
    if (s.nameLower === 'translate') return splitArgs(s.rawArgs).length >= 2 ? 1 : null
    return null
  })
  const rotSlot = firstSlot((s) =>
    s.nameLower === 'rotate' && splitArgs(s.rawArgs).length === 1 ? 0 : null,
  )
  const sxSlot = firstSlot((s) => {
    if (s.nameLower === 'scalex') return splitArgs(s.rawArgs).length === 1 ? 0 : null
    if (s.nameLower === 'scale') return splitArgs(s.rawArgs).length >= 1 ? 0 : null
    return null
  })
  const sySlot = firstSlot((s) => {
    if (s.nameLower === 'scaley') return splitArgs(s.rawArgs).length === 1 ? 0 : null
    if (s.nameLower === 'scale') {
      const argc = splitArgs(s.rawArgs).length
      return argc >= 1 ? (argc >= 2 ? 1 : 0) : null
    }
    return null
  })

  const dTx = target.tx - start.tx
  const dTy = target.ty - start.ty
  const dRot = target.rotDeg - start.rotDeg
  const startScale =
    Number.isFinite(start.scale) && Math.abs(start.scale) > POSE_EPSILON ? start.scale : 1
  const mul = Number.isFinite(target.scale) ? target.scale / startScale : 1

  const edits: SlotEdit[] = []
  const insert = new Set<string>()
  const w = dims?.width ?? 0
  const h = dims?.height ?? 0

  const putLen = (
    slot: SlotRef | null,
    deltaPx: number,
    insertName: string,
    axisDim: number,
  ): void => {
    if (!(Math.abs(deltaPx) > POSE_EPSILON)) return
    if (!slot) {
      insert.add(insertName)
      return
    }
    edits.push({
      kind: 'len',
      add: deltaPx,
      mul: 1,
      axisDim,
      spanIdx: slot.spanIdx,
      argIdx: slot.argIdx,
    })
  }

  putLen(txSlot, dTx, 'translatex', w)
  putLen(tySlot, dTy, 'translatey', h)

  if (Math.abs(dRot) > POSE_EPSILON) {
    if (!rotSlot) insert.add('rotate')
    else
      edits.push({
        kind: 'angle',
        add: dRot,
        mul: 1,
        axisDim: 0,
        spanIdx: rotSlot.spanIdx,
        argIdx: rotSlot.argIdx,
      })
  }

  if (Math.abs(mul - 1) > POSE_EPSILON) {
    if (!sxSlot && !sySlot) {
      insert.add('scale')
    } else {
      // Shared scale(a) slot (sx and sy resolve to the same span:arg):
      // multiply ONCE — both axes flow through that single argument.
      const shared =
        sxSlot && sySlot && sxSlot.spanIdx === sySlot.spanIdx && sxSlot.argIdx === sySlot.argIdx
      if (shared) {
        edits.push({
          kind: 'scale',
          add: 0,
          mul,
          axisDim: 0,
          spanIdx: (sxSlot as SlotRef).spanIdx,
          argIdx: (sxSlot as SlotRef).argIdx,
        })
      } else {
        if (sxSlot)
          edits.push({
            kind: 'scale',
            add: 0,
            mul,
            axisDim: 0,
            spanIdx: sxSlot.spanIdx,
            argIdx: sxSlot.argIdx,
          })
        else insert.add('scalex')
        if (sySlot)
          edits.push({
            kind: 'scale',
            add: 0,
            mul,
            axisDim: 0,
            spanIdx: sySlot.spanIdx,
            argIdx: sySlot.argIdx,
          })
        else insert.add('scaley')
      }
    }
  }

  return { edits, insert, dTx, dTy, dRot, mul }
}

function formatInsertedFn(
  name: string,
  dTx: number,
  dTy: number,
  dRot: number,
  mul: number,
): string {
  switch (name) {
    case 'translatex':
      return `translateX(${fmtLen(dTx)})`
    case 'translatey':
      return `translateY(${fmtLen(dTy)})`
    case 'rotate':
      return `rotate(${fmtAngle(dRot)})`
    default:
      return `${CANONICAL_INSERT_NAME[name]}(${trimNum(mul)})`
  }
}

/**
 * Produce the composite stack string for one gizmo drag frame.
 *
 * Given the START stack value, its drag-start pose (`start` — from
 * gizmoMath.parseCompositeTransform against the SAME frozen `dims`) and the
 * TARGET composite pose for this frame, returns a new stack whose pose equals
 * `target` (within rounding):
 *
 *   - translation/rotation deltas accumulate onto the FIRST translateX/Y/
 *     rotate() argument; channels with no carrier function get one INSERTED
 *     AT THE FRONT (order: translateX, translateY, rotate, then scale family
 *     — owner decision 1).
 *   - `target.scale/start.scale` multiplies into the first scale-family
 *     argument (a shared scale(a) arg carries both axes once).
 *   - EDITED arguments are rewritten in canonical units — lengths as px
 *     (percentages baked against `dims`, owner decision 4), angles as deg,
 *     scales as plain numbers — which makes parse→write→parse stable. All
 *     NON-edited bytes of the stack are preserved verbatim.
 *
 * Defensive totals: identity deltas, unparseable values and strict-syntax
 * violations return `startValue` unchanged.
 */
export function applyGizmoPoseToStack(
  startValue: string,
  start: StackPose,
  target: StackPose,
  dims?: StackDimsLike | null,
): string {
  const v = typeof startValue === 'string' ? startValue.trim() : ''
  const unchanged = () => (typeof startValue === 'string' ? startValue : '')

  const startScaleSafe =
    Number.isFinite(start.scale) && Math.abs(start.scale) > POSE_EPSILON ? start.scale : 1
  const dTx = target.tx - start.tx
  const dTy = target.ty - start.ty
  const dRot = target.rotDeg - start.rotDeg
  const mul = Number.isFinite(target.scale) ? target.scale / startScaleSafe : 1
  const identity =
    Math.abs(dTx) <= POSE_EPSILON &&
    Math.abs(dTy) <= POSE_EPSILON &&
    Math.abs(dRot) <= POSE_EPSILON &&
    Math.abs(mul - 1) <= POSE_EPSILON
  if (identity) return unchanged()

  if (!v || v.toLowerCase() === 'none') {
    // Fresh canvas: the gesture delta becomes newly inserted functions.
    const fresh: string[] = []
    if (Math.abs(dTx) > POSE_EPSILON) fresh.push(`translateX(${fmtLen(dTx)})`)
    if (Math.abs(dTy) > POSE_EPSILON) fresh.push(`translateY(${fmtLen(dTy)})`)
    if (Math.abs(dRot) > POSE_EPSILON) fresh.push(`rotate(${fmtAngle(dRot)})`)
    if (Math.abs(mul - 1) > POSE_EPSILON) fresh.push(`scale(${trimNum(mul)})`)
    return fresh.length > 0 ? fresh.join(' ') : unchanged()
  }

  const spans = scanRawSpans(v)
  if (!spans || spans.length === 0) return unchanged()

  const { edits, insert } = planSlotEdits(spans, start, target, dims ?? undefined)
  if (edits.length === 0 && insert.size === 0) return unchanged()

  // Group edits by span so each span rebuilds ONCE from all its slot edits
  // (translate(x,y) carries tx AND ty; scale(a,b) carries sx AND sy).
  const bySpan = new Map<number, Map<number, SlotEdit>>()
  for (const e of edits) {
    let perArg = bySpan.get(e.spanIdx)
    if (!perArg) {
      perArg = new Map()
      bySpan.set(e.spanIdx, perArg)
    }
    perArg.set(e.argIdx, e)
  }

  // Rebuild affected spans right-to-left so earlier offsets stay valid.
  const orderedSpanIdxs = [...bySpan.keys()].sort((a, b) => spans[b].start - spans[a].start)
  let out = v
  for (const spanIdx of orderedSpanIdxs) {
    const span = spans[spanIdx]
    const perArg = bySpan.get(spanIdx)
    if (!perArg) continue
    const pieces = span.rawArgs.trim().split(',')
    const rebuiltPieces = pieces.map((piece, i) => {
      const e = perArg.get(i)
      if (!e) return piece.trim()
      const oldArg = piece.trim()
      if (e.kind === 'len') return fmtLen(lenArgToPx(oldArg, e.axisDim) + e.add)
      if (e.kind === 'angle') return fmtAngle((angleArgToDeg(oldArg) ?? 0) + e.add)
      const p = parseNumUnit(oldArg)
      const oldN = p && Number.isFinite(p.n) ? p.n : 1
      return trimNum(oldN * e.mul)
    })
    const rebuiltArgs = rebuiltPieces.join(', ')
    const openParen = out.indexOf('(', span.start)
    if (openParen === -1) continue // defensive; scan guarantees existence
    const rawStart = openParen + 1
    const rawEnd = rawStart + span.rawArgs.length
    out = `${out.slice(0, rawStart)}${rebuiltArgs}${out.slice(rawEnd)}`
  }

  // Front-insertions for channels with no carrier function, in the approved
  // translate → rotate → scale order, leftmost of the final stack.
  if (insert.size > 0) {
    const fresh = [...insert]
      .sort((a, b) => insertRank(a) - insertRank(b))
      .map((name) => formatInsertedFn(name, dTx, dTy, dRot, mul))
    return `${fresh.join(' ')} ${out}`
  }

  return out
}
