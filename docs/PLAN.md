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
  visible: boolean // added Phase 1.5
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

### Phase 1.5 — UX Foundations 🚧

Self-contained improvements with no architectural risk. Priority order:

#### 1. Layer Management

- [ ] **Rename layer** — inline click-to-edit on layer name (`contenteditable` or input swap)
- [ ] **Reorder layers** — drag handle in LayerTree, updates layer array order in store
- [ ] **Hide/show layer** — eye icon toggle; sets `visible` boolean on `Layer`
  - `generateCss` skips hidden layers
  - Preview pane applies `visibility: hidden` to hidden layer elements
  - Store mutation: `setLayerVisibility(layerId, visible)`

#### 2. Resizable Panels

- [ ] Integrate **Split.js** (2.7kb, zero deps, CSS Grid/Flex aware)
- [ ] Horizontal split: LayerTree | Preview | Inspector with min/max constraints
  - LayerTree: min 160px, max 320px
  - Inspector: min 220px, max 400px
  - Preview: takes remaining space
- [ ] Vertical split: top workspace | Timeline
  - Timeline: min 120px, max 50vh
- [ ] Sizes reset on double-click of drag handle

#### 3. Read-only Code View

- [ ] Second tab in Inspector panel: **CSS** tab alongside **Properties** tab
- [ ] Renders live output of `generateCss(doc)` — updates on every store change
- [ ] Syntax highlighting via **Shiki** (loads only the `css` grammar + one theme)
- [ ] Copy-to-clipboard button (reuses existing export util)
- [ ] Scoped to selected layer only; toggle to show full document CSS

#### 4. DevTools Token UI

See `docs/DEVTOOLS-TOKEN-UI.md` — tracked separately due to scope and UX research required.

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
- [ ] Save/load documents (IndexedDB)
- [ ] Share URL (compressed state in hash)
- [ ] Desktop app via Tauri (offline, file system access)

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
