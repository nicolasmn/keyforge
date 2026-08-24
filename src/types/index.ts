export type EasingName =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'cubic-bezier(0.34,1.56,0.64,1)'
  // Generated spring curves (see utils/spring.ts) — any linear() easing
  | (string & {})

export type AnimatableProperty =
  | 'opacity'
  | 'transform'
  | 'background-color'
  | 'color'
  | 'border-radius'
  | 'width'
  | 'height'
  | 'scale'
  | 'translate'
  | 'rotate'

export interface Keyframe {
  id: string
  time: number // ms, 0..duration
  value: string
  easing: EasingName
}

export interface Track {
  id: string
  property: AnimatableProperty
  keyframes: Keyframe[]
}

/**
 * One axis of a static transform-origin: a length-percentage string
 * ('50%', '0px', '2em', …). Keywords (left/top/center) are UI presets that
 * convert to % before storing — the store keeps the authored unit verbatim,
 * validated at write time against ORIGIN_COMPONENT_RE (utils/originMath).
 */
export interface OriginPoint {
  x: string
  y: string
}

export interface LayerElement {
  tag: string
  text?: string
  initialCss: string
  /**
   * Static transform-origin. Absent = CSS default 50% 50%. Two-value form
   * only in v1 (no z). Stored structured, NEVER mirrored into initialCss —
   * if hand-edited storage ever carries an origin inside initialCss too, the
   * structured field wins in the preview merge and is the only one exported.
   * An explicit 50% 50% stays once set (WYSIWYG; no silent normalization).
   */
  origin?: OriginPoint
}

export interface Layer {
  id: string
  name: string
  visible: boolean
  /**
   * View state: the timeline shows a single summary row instead of one row
   * per track. Optional so v1 persisted docs load unchanged (validator
   * normalizes missing/non-boolean values to `false` = expanded; no version
   * bump — see persistence.ts).
   */
  collapsed?: boolean
  element: LayerElement
  tracks: Track[]
}

export interface AnimationDocument {
  id: string
  name: string
  duration: number // ms
  layers: Layer[]
}

// ── DevTools Token UI ───────────────────────────────────────

export type TokenType = 'color' | 'number' | 'easing' | 'transform' | 'string'

export interface TokenPath {
  layerId: string
  trackId: string
  keyframeId: string
  field: 'value' | 'easing'
}

export interface SubToken {
  type: 'number'
  value: string
  unit: string
  argIndex: number
  assembler: (subs: SubToken[]) => string
}

export interface ValueToken {
  type: TokenType
  value: string
  path: TokenPath
  /** Only present when type === 'transform' */
  subTokens?: SubToken[]
}
