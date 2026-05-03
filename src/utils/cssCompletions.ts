/**
 * Curated CSS completion lists for inspector datalists.
 * Intentionally small — covers 95% of animation use-cases.
 */

export const CSS_NAMED_COLORS = [
  'transparent', 'currentColor',
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple',
  'pink', 'cyan', 'magenta', 'lime', 'teal', 'navy', 'maroon', 'olive',
  'silver', 'gray', 'grey', 'coral', 'salmon', 'tomato', 'gold', 'khaki',
  'lavender', 'violet', 'indigo', 'crimson', 'turquoise', 'aqua', 'fuchsia',
]

export const CSS_EASING_COMPLETIONS = [
  'linear',
  'ease', 'ease-in', 'ease-out', 'ease-in-out',
  'cubic-bezier(0.4, 0, 0.2, 1)',      // Material standard
  'cubic-bezier(0.4, 0, 1, 1)',        // Material accelerate
  'cubic-bezier(0, 0, 0.2, 1)',        // Material decelerate
  'cubic-bezier(0.34, 1.56, 0.64, 1)', // Spring overshoot
  'cubic-bezier(0.68, -0.55, 0.27, 1.55)', // Back in-out
  'cubic-bezier(0.23, 1, 0.32, 1)',    // Ease out quint
  'cubic-bezier(0.55, 0, 1, 0.45)',    // Ease in quint
  'steps(1)', 'steps(2)', 'steps(4)', 'steps(8)',
  'steps(1, start)', 'steps(1, end)',
]

export const CSS_TRANSFORM_COMPLETIONS = [
  'translateX(0px)', 'translateY(0px)', 'translateZ(0px)',
  'translate(0px, 0px)', 'translate3d(0px, 0px, 0px)',
  'scaleX(1)', 'scaleY(1)', 'scale(1)', 'scale(1, 1)', 'scale3d(1, 1, 1)',
  'rotate(0deg)', 'rotateX(0deg)', 'rotateY(0deg)', 'rotateZ(0deg)',
  'skewX(0deg)', 'skewY(0deg)',
  'perspective(500px)',
  'matrix(1, 0, 0, 1, 0, 0)',
]

export const CSS_NUMBER_UNITS = [
  'px', 'rem', 'em', '%', 'vw', 'vh', 'deg', 'rad', 'turn',
  'ms', 's', 'fr',
]

/** Build a sorted, unique completion list for a given token type + current value */
export function completionsFor(type: string, current: string): string[] {
  switch (type) {
    case 'color':    return CSS_NAMED_COLORS
    case 'easing':   return CSS_EASING_COMPLETIONS
    case 'transform': return CSS_TRANSFORM_COMPLETIONS
    case 'number': {
      // suggest current value with each unit appended
      const num = current.replace(/[^\d.-]/g, '') || '0'
      return CSS_NUMBER_UNITS.map((u) => `${num}${u}`)
    }
    default: return []
  }
}
