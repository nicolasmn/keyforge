# DevTools Token UI — Feature Spec

> Status: Planning / Research
> Added: 2026-05-03

## Problem

The current property inspector uses traditional form inputs (text field for value, dropdown for easing). This is functional but disconnected from the CSS mental model developers already have. The gap between “what I type in the inspector” and “what ends up in the stylesheet” is invisible.

The DevTools Token UI closes that gap by making the CSS output the primary editing surface — styled to look and feel like browser DevTools, where values are inline-editable tokens inside a read-only structural context.

---

## Goal

Replace (or augment) the property inspector with a structured code view where:

- CSS property names, selectors, braces, and at-rules are **read-only decoration**
- CSS values are **inline-editable tokens** (click to activate, type to change, Enter to commit)
- Changes propagate immediately to the store → preview updates in real time
- The UI looks like Chrome DevTools Styles panel, not a form

---

## Reference Art

- **Chrome DevTools → Styles panel** — the gold standard. Click any value, edit inline, Tab to advance to next property.
- **VS Code inline variable editing** — ghost text, in-place input, escape to cancel.
- **Figma property panels** — click numeric token, scrub with drag, type to override.
- **Framer Motion DevTools** — value tokens with type-aware controls (color swatch, number scrub).

---

## Scope

### In scope

- Render the generated CSS for the selected layer as a styled code block
- Value tokens are interactive: click → editable input, Enter → commit to store, Escape → cancel
- Tab / Shift+Tab advances between tokens in document order
- Value changes update preview in real time (no submit button)
- Token type detection: color values show a color swatch, numeric values support scroll-to-scrub
- Easing values open the easing picker (same as current inspector, contextually triggered)
- Keyboard shortcut to jump between keyframe stops (e.g. `]` / `[` to next/prev keyframe)

### Out of scope (explicitly deferred)

- **Full backpropagation** — adding new CSS properties by typing, deleting keyframe blocks, or restructuring the CSS output. The structure (which properties exist, how many keyframes) is controlled by the timeline, not this panel.
- **Free-text CSS editing** — no Monaco/CodeMirror, no arbitrary text input on the structural parts
- **Multi-layer editing** — token UI shows one layer at a time (selected layer)

---

## Token Types

The UI must detect value types to render appropriate controls:

| Token type | Detection | Control |
|---|---|---|
| Color | `#`, `rgb(`, `hsl(`, `oklch(`, named colors | Color swatch + hex/oklch input |
| Number + unit | `/^-?[\d.]+(?:px|ms|deg|%|rem|em|vw|vh)?$/` | Scrub on drag, type to edit |
| Easing | matches known easing names or `cubic-bezier(` | Easing picker popup |
| Transform fn | `translate(`, `rotate(`, `scale(`, etc. | Sub-token editing per argument |
| Plain string | anything else | Plain text input |

---

## Interaction Model

### Editing a token

1. User clicks a value token
2. Token becomes an `<input>` (or contenteditable span), sized to content
3. Structural CSS around it remains static
4. `input` event → debounced store update → preview updates live
5. `Enter` / blur → commit final value, return to display mode
6. `Escape` → revert to original value, return to display mode

### Scrubbing numeric tokens

1. Hover numeric token → cursor becomes `ew-resize`
2. `pointerdown` + `pointermove` on token → increment/decrement value
3. Modifier keys: `Shift` = ×10, `Alt` = ×0.1 (DevTools convention)
4. Release → commit to store

### Tab order

- Tab advances through tokens **in the order they appear in the rendered CSS output**
- Shift+Tab reverses
- Wraps at end of keyframe block to first token
- `]` / `[` jumps to same token in next/previous keyframe stop

---

## Layout Options

Three options under consideration. Decision deferred until prototype.

### Option A — Inspector tab (additive)
Token UI lives in a second tab alongside the existing form inspector. Low risk — existing inspector untouched. User switches between views. Best for initial shipping.

### Option B — Inspector replacement
Token UI replaces the form inspector entirely. Cleaner, fewer UI surfaces. Requires token UI to be fully capable before shipping.

### Option C — Side-by-side split
Token UI on the right, existing inspector on the left. Redundant but useful during transition. High visual noise.

**Current lean: Option A** — ship as a tab first, validate, then decide whether to deprecate the form inspector.

---

## Implementation Notes

### Rendering

- Generate a **token AST** from the layer’s CSS output, not raw string manipulation
- Each token has: `{ type, value, path }` — where `path` maps back to the store (`layerId`, `trackId`, `keyframeId`, `field`)
- Render token AST as a `<pre>` with spans per token
- Avoid re-rendering the full token tree on every keystroke — only swap the active input in place

### Store path mapping

The key challenge: a CSS value token must know where it lives in the store so a change can be dispatched. The token AST generation step resolves this — each value token carries a store path that the edit handler uses directly.

Example:
```ts
type ValueToken = {
  type: 'color' | 'number' | 'easing' | 'transform' | 'string'
  value: string
  path: {
    layerId: string
    trackId: string
    keyframeId: string
    field: 'value' | 'easing'
  }
}
```

### Syntax highlighting

- Structural tokens (selectors, property names, braces, at-keywords): styled with CSS variables, no library needed
- Value tokens: styled by type (color tokens get a swatch, numbers get a different hue)
- No Shiki/Prism needed for the token UI — the token AST IS the parse result
- Shiki can be used for the **read-only code view** tab (Phase 1.5 item 3), which is separate

---

## Open Questions

- **Transform sub-tokens**: `translateX(40px) rotate(45deg)` — edit as one string, or split per function argument? Splitting is better UX but significantly more parsing work.
- **Color picker**: build minimal inline swatch picker, or open a `<input type="color">`? Native color picker has poor oklch support.
- **Validation**: what happens when the user types an invalid value? Show inline error, revert on commit, or pass through and let the browser ignore it?
- **Multiple keyframes visible**: show all keyframe stops for the selected layer, or only the one at the current playhead?
- **Easing picker trigger**: click on easing token opens picker — but where does the picker render? Popover anchored to token, or fixed panel below the code view?
