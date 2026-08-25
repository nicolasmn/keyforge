import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WCAG contrast guard for the design tokens (base.css §TOKENS).
 *
 * base.css documents this contract: "Every value below is WCAG-checked —
 * see src/utils/contrast.test.ts, which parses BOTH blocks and fails CI
 * on contrast drift or token parity loss." This file IS that guard.
 *
 * It parses the `:root` (dark) and `[data-theme='light']` HSL token blocks
 * straight out of base.css — no hand-copied values — and asserts the
 * documented pairs clear WCAG AA (4.5:1 normal text) on their surfaces.
 */

const BASE_CSS = readFileSync(join(__dirname, '../../src/styles/base.css'), 'utf8')

/** RGB triple, 0..1 per channel. */
type RGB = [number, number, number]

/** Parse a theme block's `--token` color declarations (hsl() or #hex) into RGB. */
function parseTheme(block: string): Record<string, RGB> {
  const tokens: Record<string, RGB> = {}
  const hsl = /--([\w-]+):\s*hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)/g
  let m: RegExpExecArray | null
  while ((m = hsl.exec(block)) !== null) {
    const [h, s, l] = [Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100]
    tokens[m[1]] = hslToRgb(h, s, l)
  }
  const hex = /--([\w-]+):\s*#([0-9a-fA-F]{6})\b/g
  while ((m = hex.exec(block)) !== null) {
    const n = parseInt(m[2], 16)
    tokens[m[1]] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }
  return tokens
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
  }
  return [f(0), f(8), f(4)]
}

// Bound each slice to its block's closing brace so later sections
// (chip palette etc.) don't leak into the parity comparison.
function themeBlock(startMarker: string): string {
  const start = BASE_CSS.indexOf(startMarker)
  const end = BASE_CSS.indexOf('\n  }', start)
  return BASE_CSS.slice(start, end)
}
const darkBlock = themeBlock(':root {')
const lightBlock = themeBlock("[data-theme='light']")
const dark = parseTheme(darkBlock)
const light = parseTheme(lightBlock)

function relativeLuminance([r, g, b]: RGB): number {
  const lin = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function contrast(fg: RGB, bg: RGB): number {
  const [a, b] = [relativeLuminance(fg), relativeLuminance(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

/** WCAG AA for normal text. */
const AA = 4.5

describe('design token contrast (base.css §TOKENS)', () => {
  it('both theme blocks parse with full token parity', () => {
    const dk = Object.keys(dark).sort()
    const lt = Object.keys(light).sort()
    expect(lt).toEqual(dk)
    expect(dk.length).toBeGreaterThan(10)
  })

  it('dark: text/muted clear AA on surface and surface-2', () => {
    expect(contrast(dark['color-text'], dark['color-bg'])).toBeGreaterThanOrEqual(AA)
    expect(contrast(dark['color-text'], dark['color-surface'])).toBeGreaterThanOrEqual(AA)
    expect(contrast(dark['color-text-muted'], dark['color-surface'])).toBeGreaterThanOrEqual(AA)
    expect(contrast(dark['color-text-muted'], dark['color-surface-2'])).toBeGreaterThanOrEqual(AA)
  })

  it('light: text/muted clear AA on surface and surface-2', () => {
    expect(contrast(light['color-text'], light['color-bg'])).toBeGreaterThanOrEqual(AA)
    expect(contrast(light['color-text'], light['color-surface'])).toBeGreaterThanOrEqual(AA)
    expect(contrast(light['color-text-muted'], light['color-surface'])).toBeGreaterThanOrEqual(AA)
    expect(contrast(light['color-text-muted'], light['color-surface-2'])).toBeGreaterThanOrEqual(AA)
  })

  it('accent is readable as text on its own theme background', () => {
    expect(contrast(dark['color-accent'], dark['color-bg'])).toBeGreaterThanOrEqual(3)
    expect(contrast(light['color-accent'], light['color-bg'])).toBeGreaterThanOrEqual(3)
  })

  it('muted stays below text prominence in BOTH themes (hierarchy)', () => {
    // Muted must remain de-emphasized relative to primary text: its
    // contrast against the surface may not exceed text's.
    expect(contrast(dark['color-text-muted'], dark['color-surface'])).toBeLessThan(
      contrast(dark['color-text'], dark['color-surface']),
    )
    expect(contrast(light['color-text-muted'], light['color-surface'])).toBeLessThan(
      contrast(light['color-text'], light['color-surface']),
    )
  })
})
