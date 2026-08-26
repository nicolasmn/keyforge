# Keyforge — Product Plan

> Last updated: 2026-08-25

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
- **Modern CSS** — `@layer`, custom properties, dark/light themes from one token set, no utility framework
- **Native Canvas 2D** — timeline rows/ruler/glyphs (DPR-aware, ResizeObserver); vertical geometry owned by a pure row model shared with the DOM header column
- **Web Animations API** — scrubbing via negative `animation-delay`
- **CodeMirror 6** — the always-on live CSS editor panel (lazy-loaded chunk, textarea fallback)
- **Split.js** — resizable panels (Preview | Inspector horizontal split; workspace | Timeline vertical split)
- **@thisbeyond/solid-dnd** — layer reorder inside the timeline header column (pointer + touch)
- **@solid-primitives/storage** — reactive persisted state (`makeObjectStorage` in-memory; IndexedDB-ready) — easing library + UI prefs
- **Vitest** — unit tests for store mutations, geometry models, snapping math, and CSS generation

### Layout

The LayerTree sidebar is gone (#95): the timeline's header column **is** the layer surface. Two resizable workspace panes; playback controls live in the timeline's transport strip.

```
┌─────────────────────────────────────────────────┐
│ DocBar: projects ▾ · doc name · Import ▾ │      │
│         Export ▾ · theme toggle                 │
├──────────────────────────────┬──────────────────┤
│  Preview                     │  Property        │
│  (real DOM + injected        │  Inspector       │
│  <style>; stage overlays     │  (token chips,   │
│  for gizmos + origin picker) │  dials, easing   │
│                              │  popover, code)  │
├──────────────────────────────┴──────────────────┤
│  Timeline                                       │
│   ┌ transport strip ─────────────────────────┐  │
│   │ play/pause · stop · loop · duration ·    │  │
│   │ snap ▾ · rate ▾ · undo/redo ·            │  │
│   │ Live-Editing · Show origins              │  │
│   ├─ header column ─┬─ canvas ───────────────┤  │
│   │ layer bands:    │ ruler · work area ·    │  │
│   │ eye/name/rename │ span bars · easing     │  │
│   │ dnd reorder     │ glyphs · diamonds ·    │  │
│   │ + Add layer     │ playhead               │  │
│   └─────────────────┴────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

Panel splits (Split.js):

- **Horizontal**: Preview | Inspector — defaults 68/32; inspector clamped to ≤400px
- **Vertical**: top workspace | Timeline — defaults 70/30; timeline capped at 50vh
- Proportions re-clamp to min/max on window resize (audit F14 fix, #63); double-click a gutter resets that split

Mobile (≤768px): DocBar hidden; two tabs — Preview (with embedded timeline + transport strip) and Inspector.

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
  collapsed?: boolean // view state: summary row instead of per-track rows
  element: LayerElement // tag, initialCss, text?, origin? (static transform-origin)
  tracks: Track[] // ONE track per property — duplicates rejected at store level
}

type Track = {
  id: string
  property: AnimatableProperty
  // 'opacity' | 'transform' | 'background-color' | 'color' | 'border-radius'
  // | 'width' | 'height' | 'scale' | 'translate' | 'rotate'
  keyframes: Keyframe[]
}

type Keyframe = {
  id: string
  time: number // ms, 0..duration
  value: string // raw CSS value
  easing: EasingName // named | cubic-bezier(...) | linear(...) spring curves
}
```

Notes:

- Duplicate property tracks can't compose (css-animations-1 "last one wins"), so `addTrack` dedupes; multiple transform-TYPE tracks merge into one composed transform channel at generation/export time (#55)
- Individual spatial properties (`rotate` bare angle, `translate` space-separated pair, `scale` number) are first-class; legacy function-form values normalize at import/emission (#54)
- `transform-origin` is a structured static field on `LayerElement` (`origin?: {x, y}`), never spliced into `initialCss`, exported as its own declaration (#103)

---

## Shipped — Feature Inventory

### Core Editor & Layout ✅

- [x] Two-pane workspace: Preview | Inspector over the unified timeline (#95)
- [x] Timeline header column as the single layer surface: chevron collapse, eye visibility, inline rename, drag-to-reorder via solid-dnd, ghost "+ Add layer" row (#90/#95)
- [x] Collapsible layers → single summary row ("N tracks · M kfs"); geometry owned by `src/utils/rowModel.ts`, shared by canvas draw, hit-testing AND the DOM column so they can't drift (#71)
- [x] Resizable panels w/ resize re-clamping; preview stage authored 600×400 and scale-to-fit (#63)
- [x] Mobile tabs (Preview+timeline / Inspector) (#36-era, refined since)
- [x] DocBar regrouped into project cluster | name | Import ▾ | Export ▾ with uniform popover contract (#48, #83)

### Timeline ✅

- [x] Canvas 2D rows via `rowModel.ts`: DevTools-style span bars connecting each track's keyframes; easing glyphs between adjacent diamonds sampled from the bezier/spring curve (#86, #98)
- [x] Right-click context menus — keyframes (duplicate / easy-ease / hold / delete), lanes (add keyframe at time / easy-ease track / clear), layers (collapse / rename / duplicate / delete) (#100)
- [x] Ruler: adaptive tick density + label gridlines (#67); configurable snap increment with ghost-chip preview — cursor stays fluid mid-drag, value snaps once on release (#77)
- [x] Work-area loop bookends draggable on the ruler; playback loops within them (#91)
- [x] Playhead with full-height grab zone + triangle head; diamond hover/selected states (audit F10/F24/F25 fixes, #62)
- [x] Playback transport strip above the ruler: play/pause/stop, loop, inline duration editor, snap select, rate presets (Shift+, / Shift+.), undo/redo buttons, Live-Editing toggle, Show-transform-origins toggle (#69, #88, #91, #105 R1, #106)
- [x] Space toggles play/pause globally (input-guarded); Ctrl/Cmd+Z / +Shift undo/redo (#57, #89)
- [x] Cross-highlighting timeline ↔ inspector keyframes (#82)

### Preview & Stage Gizmos ✅

- [x] **TransformOverlay gizmos** — move (body drag), rotate (stem handle), corner-uniform scale on individual-property tracks; auto-key always-on via `gizmoWritePolicy`; rAF-throttled live writes; pause-on-grab; floating value chips (#105)
- [x] Gesture cancel is structural: `applyGizmoEdit` returns edit receipts so Esc restores overwritten values / removes created keyframes+tracks in reverse order — independent of the undo stack's burst window
- [x] Visibility contract (plan Revision 1): Live-Editing ON → every visible layer draws its posed outline, selection adds handles; OFF → Phase-1 hover-gated chrome (active gestures still pin the overlay until pointerup/Esc)
- [x] Spatial snapping via `snapSpatial.ts`: alignment guides against other layers' edges/centers + stage centerlines (6px threshold), whole-pixel translate/scale snapping; Alt = axis-lock move that bypasses alignment targets; Shift-rotate steps 15°
- [x] Composite `transform` stacks compose into the drawn gizmo geometry read-only (#107); layers animated only by composite stacks show an inert "edit in inspector" badge — drags onto stacks are Phase 3
- [x] **OriginOverlay** — static transform-origin picker ("Pick on stage" click/drag-to-place, 9-point preset grid), crosshair debug markers behind the persisted showOrigins toggle (#81, #103, #106)
- [x] Undo/redo: snapshot-based, document-scope, 300ms burst coalescing so a whole drag lands as one entry (#89)

### Inspector ✅

- [x] Token chips with type detection (color/number/easing/transform/string); sub-token scrubbing through one module-scope session shared with number chips — 1-unit ladder, Alt ÷10 fine, Shift ×10 coarse, 4px tap threshold preserves click-to-edit (#44, #88)
- [x] Rotation dial on angle args with live per-frame updates + commit-on-release; EyeDropper support (#64, #68)
- [x] Easing popover anchored to curve chips: canvas curve preview + ball demo, numeric P1/P2 fields, grouped preset grid, **spring mode** (perceptual sliders → generated `linear()` curves), saveable custom library, batch easy-ease assistant (#34, #48, #53, #84, #86)
- [x] Property registry with unit intelligence; transform stack composer (add/remove/reorder functions) (#42, #43)
- [x] Transform-origin section: numeric fields, magnet presets, Pick-on-stage entry point
- [x] Keyboard nudging (↑↓), uniform Escape contract (#47, #48)

### Code, Import & Export ✅

- [x] **CodeView = always-on CodeMirror 6 live editor** — full-document canonical CSS, clean/dirty sync (external changes never clobber typed edits; chip + Reload instead), Apply via Ctrl/Cmd+Enter round-trips through commit enrichment; lazy chunk + textarea fallback (#79, #80)
- [x] Import: JSON file or paste-CSS modal with focus/validation contract (#58); `@keyframes` parsing populates an editable document with lossless export↔import round-trip (#32, #33)
- [x] Export: one `@keyframes` rule PER TRACK (no false hold stops across tracks, #51); multi-transform tracks merged into a composed channel (#55); slug-based animation names `kf-<slug>` with preview/import parity (#104); conditional `transform-origin` declarations; reduced-motion-safe variant (full motion gated behind `prefers-reduced-motion: no-preference`, opacity-only fallback inside `reduce`) (#35)

### Store, Persistence & Onboarding ✅

- [x] Projects system: switcher, create/duplicate/delete/rename with unique-name enforcement, sample-as-project self re-registration, legacy autosave migration, delete fall-over to next readable project (#74)
- [x] Per-project autosave (300ms debounce) with recency-sorted registry; undo history resets per document
- [x] Persisted prefs blob (`keyforge:prefs:v1`): theme, snapIncrement, workArea, playbackRate, liveEdit, showOrigins
- [x] True first run seeds a 0-layer doc so the guided EmptyState fires; starter Box layer lives behind "Add your first layer"; `keyforge:onboarded` flag stops re-nagging (#60)
- [x] Light theme token overrides + WCAG contrast CI guard (#73, #101)
- [x] Chrome motion-personality pass with reduced-motion guards (entrances, idle float) (#61)

---

## Feature Roadmap (open items)

### Transform Gizmos — Phase 3

- [ ] Map stage drags onto `translateX()/translateY()/rotate()/scale()` functions inside composite `transform` stacks (`transformStack` surgery) — replaces the inert badge
- [ ] Multi-select gizmos (blocked on data-model decision: which layer owns the written keyframe?)

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

### Phase 4 — Power Features

- [ ] Multi-layer sequencing with offset delays
- [ ] Stagger helper: auto-generate delay increments across layers
- [ ] View Transitions API mode: old/new pseudo-element keyframe generation
- [ ] Share URL (compressed state in hash)
- [ ] IndexedDB persistence upgrade — swap `makeObjectStorage` → `localforage` (easing library + projects)
- [ ] Desktop app via Tauri (offline, file system access) — use `tauriStorage` from `@solid-primitives/storage/tauri`

### Parked / Pending Decision

- [ ] Animated transform-origin TRACKS (PR #102 branch): pivot as a keyframed, interpolating track incl. import coverage — feature-complete per `docs/REPORT-transform-origin-phase-b-2026-08-25.md`; awaiting merge-or-park call
- [ ] Playwright e2e for critical flows (create layer → add keyframe → export)

---

## Testing Strategy

- **Unit tests** (Vitest): pure functions only — store mutations/guards, row model, snapping (`snap.ts` time, `snapSpatial.ts` stage), gizmo math + write policy, origin math, interpolation, tokenize/assembler round-trips, CSS generation, export purity, persistence validators
- **No component/DOM tests** — SolidJS reactivity is exercised via store logic and pure models, not mounted components
- **Manual testing**: preview pane is ground truth (renders real CSS); periodic CDP-driven audits drive the real app (see `docs/UIUX-AUDIT-2026-08-24.md`)
- **Contrast CI guard** fails the build on WCAG regressions in theme tokens (#101)
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
- Merge-or-park PR #102 (animated transform-origin tracks)? Report recommends merging to complete property-system coverage; low everyday priority.
- Gizmo gesture ↔ undo granularity: the 300ms burst window can fold a follow-up click into a drag's entry — acceptable so far; revisit with an explicit `beginGesture/endGesture` transaction API if it bites.
