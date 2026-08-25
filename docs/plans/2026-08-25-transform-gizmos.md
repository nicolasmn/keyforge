# Transform Gizmos — On-Canvas Editing Research & Implementation Plan (2026-08-25)

> Status: PLAN ONLY (no feature code in this commit)
> Branch: `steward/plan-transform-gizmos` · Base: `origin/main` @ `844d560`
> Scope: Illustrator/Figma-style manipulation of layer transforms **in the preview stage** — move (translate), rotate, scale — complementing the inspector dials/chips, which stay.
> Research basis: full read of Preview.tsx, OriginSection/OriginOverlay/originPickState/originMath (Phase A overlay precedent), Inspector chip/scrub architecture, propertyRegistry, interpolate, snap.ts, store undo funnel, transform-ux plan.

## Decision points for Nicolas

1. **Auto-key**: always-on (drag creates/updates keyframes at playhead unconditionally — recommended, matches AE pose-capture philosophy) vs an explicit toggle?
2. **Composite `transform` tracks**: v1 edits only the _individual_ `translate`/`rotate`/`scale` properties and shows a hint on layers whose motion lives in a composite function stack? Or do we map drags onto `translateX/Y` functions inside the stack in v1 already (transformStack surgery — riskier)? **Recommendation: defer composite to Phase 3.**
3. **Handle visibility**: gizmo box always visible on selected layer (Figma-like) vs hover-to-show?
4. **Spatial snapping** (edges/centers vs other layers + stage center): v1 or Phase 2? Note: **no spatial snap utility exists today** (`snap.ts` is time-only quantization for the timeline) — this is new-module work either way. **Recommendation: Phase 2.**
5. **Scale affordances**: corners only (uniform) vs corners + edge handles (per-axis)? **Recommendation: corners-only v1.**

---

## 1. Current-state findings

### 1a. Transform data model — three individual properties + one composite

| Site                | Evidence                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Property union      | `src/types/index.ts:11–22` — `transform` (composite), plus individual `scale`, `translate`, `rotate`.                                                                                                           |
| Registry            | `src/utils/propertyRegistry.ts:39–94` — `transform` takes function values (`translateY(40px)`); `scale` bare number (`'1'`); `translate` space-separated lengths (`'0px 0px'`); `rotate` bare angle (`'0deg'`). |
| Composite stack ops | `src/utils/transformStack.ts` — `addTransformFn/removeTransformFn/moveTransformFn`, serialize emits `'none'` for empty stacks; deliberately NOT applied to individual-property tracks (transform-ux plan §2).   |
| Value normalization | `toCssPropertyValue` (`propertyRegistry.ts:127–164`) normalizes legacy function forms to individual syntax at emission/import.                                                                                  |
| Interpolation       | `interpolatedValueAt` (`interpolate.ts`) — scalar lerp + pair-lerp (per-axis unit match, PR #102); hold semantics otherwise. This is the pose-capture primitive behind "+ KF at playhead".                      |

**Implication**: drags can write directly into existing individual-property tracks with zero new representation. Composite `transform` stacks are string surgery (parse args, rebuild via assembler) — possible but a different risk class (see Decision 2).

### 1b. Preview structure — where gizmos mount

- Layers are divs with `data-layer-id=slugify(name)`, styled by `mergeInitialCss(element)` + visibility override (`Preview.tsx:138–150`; structured-origin merge landed separately, see PR #103).
- Animation arrives via injected `<style>` (`generateCss`) scrubbed with negative `animation-delay` per playhead effect (`Preview.tsx:65–70`).
- Stage authored at fixed 600×400, scaled via `--preview-scale` published by a ResizeObserver (`Preview.tsx:120–132`).
- **Overlay precedent**: `<OriginOverlay />` mounts as sibling INSIDE `.preview__canvas` AFTER the layer `<For>` (`Preview.tsx:151–154`) — absolute inset:0, never joins flex flow. Pick mode is a shared signal (`components/originPickState.ts`); the gesture contract (offset-based coordinates, single-commit-on-release, Esc cancel, Shift axis-constrain, magnet presets) lives in `OriginSection.tsx` + `utils/originMath.ts`.

### 1c. Coordinate math precedent — offsets, not rects

`originMath.ts` computes from `el.offsetLeft/Top/Width/Height`: pre-transform layout values relative to `.preview__canvas` — immune BOTH to ancestor `--preview-scale` scaling AND to the element's own animated WAAPI transform. Pointer→% mapping divides by the overlay rect (same scaled space) so ratios cancel zoom (`originFromPointer`, scale-invariance property tested).

**For gizmos this means**: the bounding box handles draw is the **un-transformed reference box**, always. What animates is the element; what the user grabs is stable geometry. Rotation/scale VALUES shown at the handles come from the tracks (`interpolatedValueAt` at playhead), not from measuring the DOM. `getBoundingClientRect()` is explicitly avoided (post-transform AABB, wrong anchor mid-animation).

### 1d. Gesture/live-update architecture

- **Owner preference (est. #88)**: values update LIVE during drag, rAF-throttled — overrides the origin picker's commit-on-release model for gizmos. Precedent: RotationDial `onLive` + module-scope scrub session (`Inspector.tsx:131–167`) whose config snapshots survive chip re-mounts across per-frame commits.
- **Undo**: snapshot-based `createUndoStack` intercepting `setDoc`; bursts inside 300ms coalesce into ONE entry (`store/index.ts:147–172`). A drag streaming rAF writes (<17ms apart) naturally coalesces into a single undo entry. Caveat: an unrelated change landing ≤300ms after release merges into the same entry — acceptable v1; an explicit `beginGesture/endGesture` transaction API is the clean fix if it bites.
- **Snapping**: `snap.ts` quantizes TIME only (`snapTime`). The #77 ghost-line+chip UX visualizes time snapping on the ruler. **No spatial alignment utility exists** — canvas guides are new work (Decision 4).

### 1e. Playback interplay

Every existing canvas gesture calls `setPlaying(false)` on grab (ruler scrub, keyframe drag, duration resize — `Timeline.tsx:689–752`). Gizmos follow suit: grabbing any handle pauses playback; resuming stays manual. Editing while playing would fight the WAAPI scrub loop for the same values.

---

## 2. Data mapping (recommendation)

**Gizmo gestures always operate on tracks; missing tracks are auto-created at the playhead (auto-key, Decision 1).**

Per-axis mapping:

| Handle/drag      | Property written | Value form                                              |
| ---------------- | ---------------- | ------------------------------------------------------- |
| Move (body drag) | `translate`      | `"Xpx Ypx"` — pair value, pair-lerp interpolates (#102) |
| Rotate handle    | `rotate`         | `"Ndeg"`                                                |
| Corner scale     | `scale`          | uniform number (distance ratio from origin)             |

Precedence rules:

- Layer has an individual track for the property → write at playhead per auto-key policy (§4).
- No track → create track + one keyframe at playhead (hold fills the rest).
- **Composite-only layers**: v1 renders the gizmo read-only-ish — move/rotate/scale still WORK visually (the element animates), but writes go… nowhere useful. Show a muted badge on the box: "composite transform — edit in inspector". Phase 3 maps drags onto `translateX/Y`/`rotate` functions inside the stack via `transformStack` (Decision 2).
- Rotation/scale pivot = the layer's static `origin` field (default 50% 50%). Origin TRACKS (PR #102) animate the pivot; gizmo math reads `interpolatedValueAt(originTrack, playhead)` when present, else the static field, else default — one resolver, testable pure function.

## 3. UX spec

- **Selection**: click a layer div (or its header row — cross-highlighting #82 already links these) → gizmo box appears around its offset box. Only the selected layer gets handles (multi-select out of scope v1).
- **Box + handles**: 1px accent border box; 4 corner squares (≥24px hit target, 12px glyph — origin-handle precedent `app.css:.kf-origin-handle`); rotation handle centered above top edge on a small stem, circular, cursor `grab`.
- **Cursors**: move → `move`; corners → `nwse/nesw-resize`; rotate → `grab`/`grabbing`.
- **Live feedback**: during drags, a small value chip follows the cursor showing the live property value (`"translate 34px, −12px"` / `"rotate 42°"` / `"scale 1.35×"`) — mirrors the ruler's ghost time chip (F23).
- **Esc** cancels an in-progress gesture (restores pre-drag snapshot); clicking outside deselects; `z-order`: gizmo SVG sits below the origin-picker overlay (pick mode wins when active — same stacking logic as debug markers).
- **Touch**: hit targets ≥24px; `touch-action:none` on the overlay; same flow on the mobile preview tab (one implementation serves both — EmptyState gating identical to origin overlay).

## 4. Keyframe interaction (auto-key policy)

Pure decision function, unit-testable:

```
gizmoWrite(track | null, playhead) →
  { kind: 'update-kf', kfId }        // playhead exactly on an existing keyframe (± epsilon)
| { kind: 'create-kf' }              // track exists, playhead between kfs
| { kind: 'create-track-and-kf' }    // no track yet
```

- Epsilon: exact-time hits use the same tolerance as timeline diamond picking (~8px equivalent ms).
- New keyframes inherit the leaving neighbor's easing (consistent with capture workflow).
- Undo: one gesture ≈ one entry via 300ms burst coalescing (§1d caveat documented).

## 5. Coordinate math details

All pure functions land in a new `src/utils/gizmoMath.ts` (mirrors originMath's no-DOM discipline):

- `moveDelta(e, startRect)` → `{dx, dy}` in layout px → translate components in px (unit conversion trivial: 1 layout px = 1 CSS px on the reference box).
- `rotationDelta(e, startPos, pivotLayout)` → signed angle between start/current pointer vectors around pivot, normalized to (−180°, 180°], accumulated onto the START track value (never re-measured from DOM mid-gesture). Shift snaps to 15° increments (DevTools/AE convention).
- `scaleFactor(corner, startPos, curPos, pivotLayout)` → distance(pivot→cur)/distance(pivot→start), clamped [0.05, 20]; Shift constrains to the diagonal axis.
- All three take rects/points as arguments — scale-invariance property tests mirror `originFromPointer`'s.

## 6. Performance

- One SVG overlay component (like the debug view), handles as Solid-managed nodes; drag math runs in pointermove handlers, store writes throttled to rAF (module-scope session pattern, §1d).
- `interpolatedValueAt` results memoize per `(trackId, playheadTick)` — playhead already ticks at most once per frame.
- No per-frame layout reads: offset boxes refresh on a ResizeObserver bump + docStructure change only (same trigger set as the origin debug view).

## 7. Phasing

**Phase 1 — core gizmos (one PR)**: selection box + move + rotate + corner-scale on individual-property tracks; auto-key always-on; live rAF updates; pause-on-grab; value chips; Esc cancel; undo coalescing; mobile tab parity. Tests for gizmoMath + autoKey policy.

**Phase 2 — spatial snapping**: new `snapSpatial.ts` (candidate lines: other layers' edges/centers, stage center/edges, 8px threshold in layout px); ghost guide lines + chips matching #77's visual language; Shift disables snapping while held.

**Phase 3 — composite transform mapping**: drags decompose into `translateX()/translateY()/rotate()/scale()` functions inside existing stacks via `transformStack` surgery; badge removed. Requires careful arg-index bookkeeping in the assembler (precedent: sub-token rebuild in `tokenize.ts:45–81`).

## 8. Test list (vitest, node env)

- [ ] `gizmoMath.moveDelta`: scale-invariance property (same ratios at arbitrary rect scales); clamping none needed (free move).
- [ ] `gizmoMath.rotationDelta`: known-angle cases (90° quadrants), wrap-around at ±180°, Shift-snap to 15°.
- [ ] `gizmoMath.scaleFactor`: identity at start position, monotonic with distance, clamp bounds, origin-offset pivots.
- [ ] `resolvePivot(layer)`: origin track at playhead > static field > default 50% 50% (uses PR #102 interpolation).
- [ ] `gizmoWrite` policy table: exact-hit update / between-kfs create / no-track create-track-and-kf; epsilon boundaries.
- [ ] Export purity untouched: gizmos write only track data; documents without gizmo interaction byte-identical (existing golden tests cover).
- [ ] transformStack helpers unaffected (existing suite green).

Manual QA matrix: themes × reduced-motion × mobile preview tab × playback grab-pause × origin-picker overlap (pick mode suppresses gizmo handles).

## 9. Risks / open questions

- `position:fixed` in user initialCss breaks the offsetParent chain (same hazard as origin picker §9 — reuse its defensive fallback).
- Zero-size elements: division-by-zero in scale math → hide handles, keep move only.
- Elements fully animated by composite stacks show a non-editable gizmo in v1 — discoverability of the badge needs a look in review.
- Undo post-release merge window (≤300ms) may fold a follow-up click into the gesture entry — acceptable, revisit if owner notices.
- Interaction conflict with future origin PICK mode: defined (pick wins, gizmo suppressed) but needs a visual spec pass.
- Multi-select deferred — data model (which layer owns the written keyframe?) is the reason; revisit after Phase 1 usage.
