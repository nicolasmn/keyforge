import type { Layer, ValueToken, SubToken, TokenType, TokenPath, Track, Keyframe } from '@/types'
import type { AnimationDocument } from '@/types'

const NUMBER_UNIT_RE = /^(-?[\d.]+)(px|ms|deg|%|rem|em|vw|vh|fr|s|turn|rad)?$/
const EASING_NAMES = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-quad',
  'ease-out-quad',
  'ease-in-out-quad',
  'ease-in-cubic',
  'ease-out-cubic',
  'ease-in-out-cubic',
  'ease-in-back',
  'ease-out-back',
  'ease-in-out-back',
])
const TRANSFORM_FN_RE =
  /^(translateX|translateY|translateZ|translate3d|translate|rotateX|rotateY|rotateZ|rotate3d|rotate|scaleX|scaleY|scaleZ|scale3d|scale|skewX|skewY|skew|perspective|matrix3d|matrix)\(/

function detectType(value: string, field: 'value' | 'easing'): TokenType {
  if (field === 'easing') return 'easing'
  const v = value.trim()
  if (TRANSFORM_FN_RE.test(v)) return 'transform'
  if (
    v.startsWith('#') ||
    v.startsWith('rgb') ||
    v.startsWith('hsl') ||
    v.startsWith('oklch') ||
    v.startsWith('color(')
  )
    return 'color'
  // Guarded so pure-node contexts (tests, tooling) don't crash on the
  // named-color heuristic; browsers always define CSS.
  if (/^[a-z]+$/.test(v) && typeof CSS !== 'undefined' && CSS.supports('color', v)) return 'color'
  if (NUMBER_UNIT_RE.test(v)) return 'number'
  if (EASING_NAMES.has(v) || v.startsWith('cubic-bezier(') || v.startsWith('linear('))
    return 'easing'
  return 'string'
}

function parseTransformSubTokens(value: string, path: TokenPath): SubToken[] {
  const subs: SubToken[] = []
  const fnRe = /([\w-]+)\(([^)]+)\)/g
  const fnMatches = [...value.matchAll(fnRe)]
  fnMatches.forEach((fnMatch, fnIndex) => {
    const args = fnMatch[2].split(',').map((a) => a.trim())
    args.forEach((arg, argIndex) => {
      const numMatch = arg.match(/^(-?[\d.]+)(\S*)$/)
      if (!numMatch) return
      const assembler = (tokens: SubToken[]): string => {
        let result = value
        let fnIdx = 0
        result = result.replace(/([\w-]+)\(([^)]+)\)/g, (_full, fn: string, argsStr: string) => {
          const argArr = argsStr.split(',').map((a: string) => a.trim())
          const rebuilt = argArr
            .map((_: string, i: number) => {
              const t = tokens.find((st) => st.argIndex === fnIdx * 100 + i)
              return t ? `${t.value}${t.unit}` : argArr[i]
            })
            .join(', ')
          fnIdx++
          return `${fn}(${rebuilt})`
        })
        return result
      }
      subs.push({
        type: 'number',
        value: numMatch[1],
        unit: numMatch[2] || '',
        argIndex: fnIndex * 100 + argIndex,
        assembler,
      })
      void path
    })
  })
  return subs
}

export function tokenizeLayer(layer: Layer, doc: AnimationDocument): ValueToken[] {
  const tokens: ValueToken[] = []
  for (const track of layer.tracks) {
    for (const kf of track.keyframes) {
      tokens.push(...tokenizeKeyframe(layer.id, track, kf))
      void doc
    }
  }
  return tokens
}

/**
 * Tokenize one keyframe into its value + easing tokens. Operates on the
 * store's stable keyframe proxy so callers can keep component identity
 * across commits (Inspector rows).
 *
 * Transform tracks classify by PROPERTY first: a value of `'none'` (the
 * canonical state after deleting the last function — serialize() emits it
 * for an empty stack) must still type as `transform` so the Inspector's
 * transform branch (sub-chips + stack-picker add button) stays reachable.
 * Value-text detection would misfile `'none'`/`''` as `string`, which used
 * to dead-end the add flow.
 */
export function tokenizeKeyframe(
  layerId: string,
  track: Pick<Track, 'id' | 'keyframes' | 'property'>,
  kf: Keyframe,
): [ValueToken, ValueToken] {
  const valuePath: TokenPath = {
    layerId,
    trackId: track.id,
    keyframeId: kf.id,
    field: 'value',
  }
  const valueType: TokenType =
    track.property === 'transform' ? 'transform' : detectType(kf.value, 'value')
  const valueToken: ValueToken = {
    type: valueType,
    value: kf.value,
    path: valuePath,
  }
  if (valueType === 'transform') {
    valueToken.subTokens = parseTransformSubTokens(kf.value, valuePath)
  }

  const easingToken: ValueToken = {
    type: 'easing',
    value: kf.easing,
    path: {
      layerId,
      trackId: track.id,
      keyframeId: kf.id,
      field: 'easing',
    },
  }
  return [valueToken, easingToken]
}

export { detectType, NUMBER_UNIT_RE, EASING_NAMES }
export type { TokenType }
