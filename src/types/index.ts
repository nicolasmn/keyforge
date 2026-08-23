export type EasingName =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'cubic-bezier(0.34,1.56,0.64,1)'

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

export interface LayerElement {
  tag: string
  text?: string
  initialCss: string
}

export interface Layer {
  id: string
  name: string
  visible: boolean
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
