# Keyforge — Product Plan

> Last updated: 2026-05-03

## Vision

Keyforge is a visual, browser-native animation editor. It lets developers and designers create real `@keyframes` CSS animations and Web Animations API (WAAPI) code through a timeline UI — no approximations, no third-party runtime dependencies in the output.

**Core principle:** What you build in Keyforge IS the animation. Export is raw, spec-compliant CSS or JS. No Keyforge runtime needed on the target page.

---

## Target User

- Frontend developers who know CSS but want visual tooling for complex animations
- Developers building design systems and need precise, exportable animation tokens
- Solo builders prototyping motion design without switching to Figma/After Effects

---

## Architecture

### Tech Stack

- **SolidJS** + TypeScript — signal-based reactivity, no VDOM, fast partial updates
- **Vite** — instant HMR, ESNext target
- **Modern CSS** — `@layer`, custom properties, no utility framework
- **Native Canvas 2D** — timeline track rendering (DPR-aware, ResizeObserver)
- **Web Animations API** — scrubbing via negative `animation-delay`
- **Split.js** — resizable panels (horizontal + vertical splits)
- **@thisbeyond/solid-dnd** — pointer + touch sortable drag for LayerTree
- **@solid-primitives/storage** — reactive persisted state (`makeObjectStorage` in-memory; IndexedDB-ready)
- **Vitest** — unit tests for store mutations and CSS generation

### Layout

```
┌─────────────────────────────────────────┐
│  Header (logo, doc name, export)         │
├──────────┬──────────────────┬───────────┤
│  Layer   │                  │ Property  │
│  Tree    │   Preview Pane   │ Inspector │
│  (resize)│   (real DOM +    │ (tracks,  │
│          │   injected CSS)  │  keyframes│
├──────────┴──────────────────┴───────────┤
│  Playback controls         (resize ↕)   │
│  Timeline (native Canvas 2D)             │
│  scrubber · tracks · keyframe diamonds   │
└─────────────────────────────────────────┘
```

Panel splits:

- **Horizontal** (Split.js): LayerTree | Preview | Inspector
- **Vertical** (Split.js): top area | Timeline

### Data Model (core)

```ts
type AnimationDocument = {
  id: string
  name: string
  duration: number // ms
  layers: Layer[]
}

type Layer = {
  id: string
  name: string
  visible: boolean
  element: LayerElement // tag, initialCss, text
  tracks: Track[]
}

type Track = {
  id: string
  property: AnimatableProperty
  keyframes: Keyframe[]
}

type Keyframe = {
  id: string
  time: number // ms, 0..duration
  value: string // raw CSS value
  easing: EasingName
}
```

---

## Feature Roadmap

### Phase 1 — Foundation (MVP) ✅

- [x] App shell: header, sidebar, workspace, inspector, timeline panels
- [x] SolidJS store with document/layer/track/keyframe data model
- [x] All store mutations: add/remove layer, track, keyframe; update keyframe
- [x] Preview pane: real DOM elements with generated `<style>` injection
- [x] Timeline: native Canvas 2D, track rows, time ruler, playhead triangle
- [x] Draggable keyframe diamonds on timeline
- [x] Scrubbing via ruler click/drag (negative animation-delay trick)
- [x] Property inspector: value/easing inputs bound to selected keyframe
- [x] Add keyframe at playhead position
- [x] Playback controls: play/pause/stop, loop toggle, time counter
- [x] Basic properties: `transform`, `opacity`, `background-color` + 7 more
- [x] CSS export: `@keyframes` + `animation` longhand → clipboard
- [x] Unit tests: store mutations + CSS generation

### Phase 1.5 — UX Foundations ✅

_(all four sections shipped as of 2026-08-23: #12 code view, #13 duration control, #14 token UI; remaining polish items live in each section's open-tasks list)_

Self-contained improvements with no architectural risk. Priority order:

#### 1. Layer Management ✅

- [x] **Rename layer** — inline dbl-click edit (input swap; Enter/Esc/blur commit)
- [x] **Reorder layers** — `@thisbeyond/solid-dnd` sortable; works on pointer + touch
- [x] **Hide/show layer** — eye icon toggle; `visible: boolean` on `Layer`
  - `generateCss` skips hidden layers (no CSS emitted)
  - Preview pane: `visibility: hidden` via style object (not string, per `solid/style-prop`)
  - Store mutation: `setLayerVisibility(layerId, visible)`
- [x] Layer item: icon alignment fixed (`gap`, `flex-shrink: 0`)
- [x] Rename input: styled with `color-surface-2` bg + accent border

#### 2. Resizable Panels ✅

- [x] **Split.js** integrated (2.7kb, zero deps)
- [x] Horizontal split: LayerTree | Preview | Inspector
  - LayerTree: min 160px, max 320px; default 18%
  - Inspector: min 220px, max 400px; default 26%
  - Preview: takes remaining space; min 300px
- [x] Vertical split: top workspace | Timeline
  - Timeline: min 120px, max 50vh; default 30%
- [x] Double-click any gutter → resets that split to defaults
- [x] Gutters: 4px wide, accent color on hover, `col-resize`/`row-resize` cursors
- [x] `SplitLayout` component encapsulates all Split.js logic; `App.tsx` stays clean

#### 3. Read-only Code View ✅

_(merged 2026-08-23 as #12)_

- [x] Second tab in Inspector panel: **CSS** tab alongside the Inspector tab
- [x] Renders live output of `generateCss(doc)` — updates on every store change
- [x] Syntax highlighting via **Shiki** (loaded lazily from esm.sh on first render; plain `<pre>` fallback)
- [x] Copy-to-clipboard button (writes the raw unhighlighted string)
- [x] Scoped to selected layer only; toggle to show full document CSS

#### 4. DevTools Token UI ✅

_(merged 2026-08-23 as #14; QA fix list completed in the same pass — see `docs/DEVTOOLS-TOKEN-UI.md` for the revised spec)_

See `docs/DEVTOOLS-TOKEN-UI.md`.

**Implemented** _(list corrected 2026-08-23 to match the tree — several items previously claimed features that lived only in the removed TokenView prototype or were dropped during the drag-scrub removal)_:

- [x] Token AST generation (`src/utils/tokenize.ts`) — `tokenizeLayer(layer, doc) → ValueToken[]`
- [x] Type detection: `color` / `number` / `easing` / `transform` / `string`
- [x] `ValueToken`, `SubToken`, `TokenPath`, `TokenType` types in `src/types/index.ts`
- [x] Token chips in the **Inspector** tab — click (or Enter/Space when focused) to edit, Enter commits, Escape cancels, blur commits
- [x] Error state on invalid token (red border, no commit)
- [x] Numeric tokens: tap-to-edit inline number+unit field with unit selector and rotation-dial preview _(drag-scrub removed by design — 3302ef4/3526b55)_
- [x] Color tokens: 10px swatch + native `<input type="color">` picker; path uses `token.path`
- [x] Easing tokens: inline `EasingEditor` toggle (one open at a time)
- [x] `EasingEditor`: canvas curve visualiser, draggable handles (DPR-correct hit-test), preset strip
- [x] `EasingEditor`: raw `cubic-bezier(...)` input with live curve update
- [x] Easing presets: 14 built-ins in `BUILTIN_PRESETS` (`src/utils/easing-presets.ts`)
- [x] **Easing library**: `@solid-primitives/storage` `makePersisted` + `makeObjectStorage` — reactive, in-memory, IndexedDB-ready
- [x] **Save to library**: name input + Save button (Enter); upsert by name
- [x] **Delete from library**: ✕ on hover of each custom preset chip
- [x] Transform sub-tokens: per-function chip groups (`fnA(a, b) fnB(c)`), each arg editable via `SubScrub` + assembler rebuild (multi-function display fixed 2026-08-23)
- [x] Keyboard/a11y baseline: chips focusable with Enter/Space activation + `:focus-visible` outlines; easing canvas pointer events (touch/pen) + arrow-key handle nudging (1/2 switches handle, Shift = coarse)
- [x] Unit tests: tokenizer (NUMBER_UNIT_RE, detectType), transform assembler round-trips, easing math (`parseCubicBezier`/`evalCubicBezier`), easing library upsert
- [x] Easing-editor styles live in `src/styles/inspector.css` (token-view.css removed with the dead TokenView prototype)

**Open tasks:**

- [ ] Tab/Shift+Tab token chaining (advance token-to-token in document order) — existed only in the removed TokenView prototype
- [ ] `]` / `[` keyboard shortcut — jump to same token in next/prev keyframe stop
- [ ] Property-aware error `title` text (e.g. `"opacity expects 0–1"`) — currently generic red state only
- [ ] Custom oklch color picker (v2 — after native hex-only picker validated)
- [ ] Easing library persistence upgrade: swap `makeObjectStorage` → `localforage` when Phase 4 IndexedDB lands

---

### Phase 2 — Modern CSS

- [ ] `@property` support — register typed custom properties, animate them
- [ ] `animation-composition: add/accumulate` per track
- [ ] `offset-path` SVG path editor → motion path animation
- [ ] `clip-path` keyframe morphing with vertex count validation
- [ ] `animation-timeline: scroll()` binding — map keyframes to scroll position
- [ ] `animation-timeline: view()` binding — viewport entry/exit ranges
- [ ] `grid-template-rows: 0fr → 1fr` animated height
- [ ] Easing curve editor (cubic-bezier visual handles)

### Phase 3 — Export & Interop

- [ ] WAAPI export: `element.animate([...], { ... })`
- [ ] React component export (Motion wrapper)
- [ ] Animation token export (JSON: duration, easing, keyframe values)
- [ ] Copy-to-clipboard single keyframe snippet
- [ ] Import existing `@keyframes` CSS (parse and populate timeline)

### Phase 4 — Power Features

- [ ] Multi-layer sequencing with offset delays
- [ ] Stagger helper: auto-generate delay increments across layers
- [ ] View Transitions API mode: old/new pseudo-element keyframe generation
- [ ] **Save/load documents (IndexedDB)** — swap `makeObjectStorage` → `localforage` in `easingLibrary.ts`
- [ ] Share URL (compressed state in hash)
- [ ] Desktop app via Tauri (offline, file system access) — use `tauriStorage` from `@solid-primitives/storage/tauri`

---

## Testing Strategy

- **Unit tests** (Vitest): pure functions — store mutations, CSS generation, export utils, nanoid
- **No component tests** in Phase 1 — SolidJS reactivity tested via store logic, not DOM
- **Manual testing**: preview pane is the ground truth (renders real CSS)
- Future: Playwright e2e for critical user flows (create layer → add keyframe → export)

---

## Animation Technique Library

Built-in technique presets the user can apply and customise:

| Technique             | CSS Mechanism                     | Notes                                   |
| --------------------- | --------------------------------- | --------------------------------------- |
| Typed value animation | `@property` + `@keyframes`        | Smooth HSL, gradient, shadow animations |
| Additive motion       | `animation-composition: add`      | Layer bounce on top of translate        |
| Scroll-linked         | `animation-timeline: scroll()`    | Progress bar, parallax                  |
| Viewport reveal       | `animation-timeline: view()`      | Fade-in on scroll into view             |
| Motion path           | `offset-path` + `offset-distance` | Path following with auto-rotate         |
| Shape morphing        | `clip-path` polygon keyframes     | Enforce same vertex count               |
| Circular reveal       | `clip-path: circle()` expand      | Click-origin hero transitions           |
| Auto height           | `grid-template-rows: 0fr→1fr`     | Accordion expand without JS calc        |
| View Transition       | `::view-transition-*` keyframes   | Shared element page transitions         |

---

## Design Principles

1. **No runtime lock-in** — exported code runs without Keyforge
2. **Real output** — preview uses the same CSS/WAAPI as export
3. **Modern CSS first** — expose powerful spec features, don't hide them
4. **Developer audience** — show code alongside visual UI at all times
5. **Speed** — 60fps timeline scrubbing, instant preview updates

---

## Open Questions

- Multiplayer / share-by-URL collaboration?
- Plugin system for custom property types?
- AI-assisted animation generation (describe motion → keyframes)?
- DevTools Token UI backpropagation — full round-trip editing vs. token-only? (see `docs/DEVTOOLS-TOKEN-UI.md`)
