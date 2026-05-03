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
- **Konva.js** — canvas-based timeline track rendering
- **Web Animations API** — preview engine and scrubbing

### Layout
```
┌─────────────────────────────────────────┐
│  Header (logo, export, playback)         │
├──────────┬──────────────────┬───────────┤
│  Layer   │                  │ Property  │
│  Tree    │   Preview Pane   │ Inspector │
│          │                  │           │
│  (DOM    │   (real DOM +    │ (keyframe │
│  layers) │   injected CSS)  │  values)  │
├──────────┴──────────────────┴───────────┤
│  Timeline (Konva canvas)                 │
│  scrubber · tracks · keyframe diamonds   │
└─────────────────────────────────────────┘
```

### Data Model (core)
```ts
type Document = {
  id: string
  name: string
  duration: number       // ms
  layers: Layer[]
}

type Layer = {
  id: string
  name: string
  element: ElementConfig  // tag, initial CSS, HTML content
  tracks: Track[]
}

type Track = {
  property: AnimatableProperty
  easing: string         // default easing for the track
  keyframes: Keyframe[]
}

type Keyframe = {
  time: number           // ms
  value: string          // raw CSS value
  easing: string         // easing from THIS keyframe to the next
}
```

---

## Feature Roadmap

### Phase 1 — Foundation (MVP)
- [ ] App shell: header, sidebar, workspace, inspector, timeline panels
- [ ] SolidJS store with document/layer/track/keyframe data model
- [ ] Preview pane: DOM element with generated `<style>` injection
- [ ] Timeline: Konva canvas, track rows, scrubber, playhead
- [ ] Draggable keyframe diamonds on timeline
- [ ] Property inspector: value inputs bound to selected keyframe
- [ ] Playback controls: play/pause/stop, loop toggle
- [ ] Basic properties: `transform`, `opacity`, `background-color`
- [ ] CSS export: `@keyframes` + `animation` shorthand

### Phase 2 — Modern CSS
- [ ] `@property` support — register typed custom properties, animate them
- [ ] `animation-composition: add/accumulate` per track
- [ ] `offset-path` SVG path editor → motion path animation
- [ ] `clip-path` keyframe morphing with vertex count validation
- [ ] `animation-timeline: scroll()` binding — map keyframes to scroll position
- [ ] `animation-timeline: view()` binding — viewport entry/exit ranges
- [ ] `grid-template-rows: 0fr → 1fr` animated height

### Phase 3 — Export & Interop
- [ ] WAAPI export: `element.animate([...], { ... })`
- [ ] React component export (Motion wrapper)
- [ ] Animation token export (JSON: duration, easing, keyframe values)
- [ ] Copy-to-clipboard single keyframe snippet
- [ ] Import existing `@keyframes` CSS (parse and populate timeline)

### Phase 4 — Power Features
- [ ] Multi-layer sequencing with offset delays
- [ ] Easing curve editor (cubic-bezier visual, spring preview)
- [ ] View Transitions API mode: old/new pseudo-element keyframe generation
- [ ] Stagger helper: auto-generate delay increments across layers
- [ ] Save/load documents (IndexedDB)
- [ ] Share URL (compressed state in hash)

---

## Animation Technique Library

Built-in technique presets the user can apply and customise:

| Technique | CSS Mechanism | Notes |
|---|---|---|
| Typed value animation | `@property` + `@keyframes` | Smooth HSL, gradient, shadow animations |
| Additive motion | `animation-composition: add` | Layer bounce on top of translate |
| Scroll-linked | `animation-timeline: scroll()` | Progress bar, parallax |
| Viewport reveal | `animation-timeline: view()` | Fade-in on scroll into view |
| Motion path | `offset-path` + `offset-distance` | Path following with auto-rotate |
| Shape morphing | `clip-path` polygon keyframes | Enforce same vertex count |
| Circular reveal | `clip-path: circle()` expand | Click-origin hero transitions |
| Auto height | `grid-template-rows: 0fr→1fr` | Accordion expand without JS calc |
| View Transition | `::view-transition-*` keyframes | Shared element page transitions |

---

## Design Principles

1. **No runtime lock-in** — exported code runs without Keyforge
2. **Real output** — preview uses the same CSS/WAAPI as export
3. **Modern CSS first** — expose powerful spec features, don't hide them
4. **Developer audience** — show code alongside visual UI at all times
5. **Speed** — 60fps timeline scrubbing, instant preview updates

---

## Open Questions

- Desktop app via Tauri in future? (offline, file system access)
- Multiplayer / share-by-URL collaboration?
- Plugin system for custom property types?
