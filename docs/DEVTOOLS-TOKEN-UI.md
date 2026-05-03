# DevTools Token UI — Feature Spec

> Status: Implemented (Phase 1.5 §4)
> Added: 2026-05-03
> Updated: 2026-05-03

## Problem

The current property inspector uses traditional form inputs (text field for value, dropdown for easing). This is functional but disconnected from the CSS mental model developers already have. The gap between "what I type in the inspector" and "what ends up in the stylesheet" is invisible.

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
- Easing values open the inline easing editor (see Easing Library below)
- Keyboard shortcut to jump between keyframe stops (`]` / `[` to next/prev keyframe)

### Out of scope (explicitly deferred)

- **Full backpropagation** — adding new CSS properties by typing, deleting keyframe blocks, or restructuring the CSS output. The structure (which properties exist, how many keyframes) is controlled by the timeline, not this panel.
- **Free-text CSS editing** — no Monaco/CodeMirror, no arbitrary text input on the structural parts
- **Multi-layer editing** — token UI shows one layer at a time (selected layer)
- **AI-assisted features** — no AI generation, suggestion, or completion

---

## Token Types

The UI must detect value types to render appropriate controls:

| Token type    | Detection                                          | Control                                                          |
| ------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| Color         | `#`, `rgb(`, `hsl(`, `oklch(`, named colors        | Inline color swatch; click opens `<input type="color">`          |
| Number + unit | `/^-?[\d.]+(?:px\|ms\|deg\|%\|rem\|em\|vw\|vh)?$/` | Scrub on drag, type to edit                                      |
| Easing        | matches known easing names or `cubic-bezier(`      | Inline expandable easing editor (see below)                      |
| Transform fn  | `translate(`, `rotate(`, `scale(`, etc.            | Split per function argument — each argument is its own sub-token |
| Plain string  | anything else                                      | Plain text input                                                 |

### Transform sub-token splitting

`translateX(40px) rotate(45deg)` is parsed into individual function tokens, each with their own arguments as sub-tokens. Example:

```
translateX( [40] [px] )  rotate( [45] [deg] )
             ↑ editable          ↑ editable
```

The function name and parentheses are read-only decoration. Only the argument values are editable tokens. On commit, sub-tokens are reassembled into the full transform string before writing to the store.

Each function argument maps to:

```ts
type SubToken = {
  type: 'number'
  value: string
  unit: string
  path: ValueToken['path'] // same keyframe, same field
  assembler: (tokens: SubToken[]) => string // rebuilds full value string
}
```

### Color tokens

Use the browser-native `<input type="color">` picker. Known limitation: native picker works in sRGB hex only — oklch/hsl values will be converted to hex on open and written back as hex on close. This is acceptable for v1; a custom oklch picker is a future enhancement if demand exists.

---

## Validation

- Invalid values show the token in an **error state**: red underline + red text color (uses `--color-error`)
- The `title` attribute on the token element carries a short description: e.g. `"Invalid value for opacity — expected a number between 0 and 1"`
- Invalid values are **not committed** to the store on Enter/blur — the token reverts to the last valid value
- The preview reflects only committed (valid) values; invalid in-progress edits do not update the preview
- Validation is property-aware where possible (opacity range 0–1, angle requires deg unit, etc.) and falls back to a basic CSS syntax check for unknown properties

---

## Easing Library

Easing is a first-class concept in Keyforge. Rather than a simple dropdown or text input, easing tokens open a **dedicated inline easing editor** directly in the inspector panel.

### Easing editor UX

- Clicking an easing token **expands an inline panel** below the token row (not a floating popover — avoids z-index and positioning complexity)
- The panel contains:
  - **Curve visualiser** — `<canvas>` with draggable handles
  - **Preset library** — horizontal scrollable strip of named presets (built-in + user-saved custom)
  - **Custom input** — `cubic-bezier(x1, y1, x2, y2)` raw value with live curve update
  - **Save to library** — name input + Save button (Enter to confirm); upserts by name
  - **Delete from library** — ✕ button appears on hover of each custom preset
- Only one easing editor open at a time; opening a new one closes the previous
- `Escape` closes and reverts; `Enter` closes and commits

### Easing library

- Reactive in-memory store via `@solid-primitives/storage` `makePersisted` + `makeObjectStorage`
- API (`src/store/easingLibrary.ts`): `customEasings` (signal), `addEasing(name, value)`, `removeEasing(name)`, `hasEasing(name)`
- Storage: `makeObjectStorage` (in-memory, no localStorage) — swap to `localforage` (IndexedDB) in Phase 4 with zero other changes
- Upsert semantics: saving a name that already exists updates its value

### Built-in presets

| Name                | Value                                     |
| ------------------- | ----------------------------------------- |
| `ease`              | `cubic-bezier(0.25, 0.1, 0.25, 1)`        |
| `ease-in`           | `cubic-bezier(0.42, 0, 1, 1)`             |
| `ease-out`          | `cubic-bezier(0, 0, 0.58, 1)`             |
| `ease-in-out`       | `cubic-bezier(0.42, 0, 0.58, 1)`          |
| `linear`            | `linear`                                  |
| `ease-in-quad`      | `cubic-bezier(0.55, 0.085, 0.68, 0.53)`   |
| `ease-out-quad`     | `cubic-bezier(0.25, 0.46, 0.45, 0.94)`    |
| `ease-in-out-quad`  | `cubic-bezier(0.455, 0.03, 0.515, 0.955)` |
| `ease-in-cubic`     | `cubic-bezier(0.55, 0.055, 0.675, 0.19)`  |
| `ease-out-cubic`    | `cubic-bezier(0.215, 0.61, 0.355, 1)`     |
| `ease-in-out-cubic` | `cubic-bezier(0.645, 0.045, 0.355, 1)`    |
| `ease-in-back`      | `cubic-bezier(0.6, -0.28, 0.735, 0.045)`  |
| `ease-out-back`     | `cubic-bezier(0.175, 0.885, 0.32, 1.275)` |
| `ease-in-out-back`  | `cubic-bezier(0.68, -0.55, 0.265, 1.55)`  |

---

## Interaction Model

### Editing a token

1. User clicks a value token
2. Token becomes an `<input>`, sized to content
3. Structural CSS around it remains static
4. `input` event → store update → preview updates live (valid values only)
5. `Enter` / blur → validate → commit if valid, revert if invalid; return to display mode
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
- `]` / `[` jumps to same token in next/previous keyframe stop *(open task — see PLAN.md)*

---

## Layout Options

Decision: **Option A** — Inspector tab (additive). Token UI lives in a third **Tokens** tab alongside **Properties** and **CSS**.

---

## Implementation Notes

### Rendering

- Generate a **token AST** from the layer's CSS output, not raw string manipulation
- Each token has: `{ type, value, path }` — where `path` maps back to the store
- Render token AST as inline `<span>` elements
- Avoid re-rendering the full token tree on every keystroke — only swap the active input in place

### Store path mapping

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
  subTokens?: SubToken[] // transform only
}
```

### Syntax highlighting

- Structural tokens styled via CSS variables, no library needed
- Value tokens styled by type (color swatch, number `ew-resize`, easing accent color)
- Shiki used for the **read-only CSS tab** (Phase 1.5 §3), separate from this feature

---

## Resolved Decisions

| Question             | Decision                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Transform sub-tokens | Split per function argument — each arg is its own editable sub-token                                       |
| Color picker         | Browser-native `<input type="color">` — hex only in v1                                                     |
| Validation           | Error state on token (red underline + `title` description); invalid values not committed                   |
| Easing picker        | Inline expandable panel in inspector; canvas visualiser + preset library + save/delete + raw input         |
| Easing persistence   | `@solid-primitives/storage` `makePersisted` + `makeObjectStorage`; IndexedDB swap in Phase 4               |
| AI features          | None planned                                                                                               |
| Inspector placement  | Option A — third Tokens tab alongside Properties and CSS                                                   |
