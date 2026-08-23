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
