# Timing-function UI redesign — research + plan (2026-08-24)

> Research only. No code changes accompany this document.
>
> Goal: make changing a keyframe's easing faster, more visual, and more comparable.
> Scope covers access points, editor layout, live comparison, spring integration,
> and the saved-easing library. Researched against current main (`6e2d287`,
> post-#84) with file/line evidence; prior-art findings fold in the repo's own
> [inspiration catalog](./2026-08-24-inspiration-catalog.md) §3 plus fresh
> research on cubic-bezier.com-class tools and Chrome DevTools' Easing Editor.

---

## 1. Current-friction inventory

### 1.1 How easing changes today, step by step

State of the world: `Keyframe.easing` holds one CSS timing string per keyframe;
the only editing surface is `EasingEditor` mounted **inline inside the owning
`KeyframeRow`** when its text chip toggles open
(`Inspector.tsx` `KeyframeRow`, chip at lines ~798–810, `<EasingEditor>` at
~827–833).

Happy path from "looking at a keyframe" to "new easing applied":

| Step | Action                                                                                               | Cost / note                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Locate keyframe on timeline or inspector                                                             | —                                                                                                                                                                                        |
| 1    | Click diamond (timeline) → selects kf + layer, inspector scrolls row into view (#82 cross-highlight) | skipped if already in inspector                                                                                                                                                          |
| 2    | Scan row for the easing affordance                                                                   | it's **plain text** (`ease-out`) in mono purple; no curve thumbnail, no chevron — reads as a label until you know to click it                                                            |
| 3    | Click chip → `EasingEditor` expands **below the row**                                                | layout shift: every row below is pushed down by a ~600–700px block (canvas 120px + 17 wrapping preset chips + Saved section + Spring section with sliders/demo/output/apply + save form) |
| 4    | Apply: click preset / drag handles / paste raw value                                                 | commits are live during handle drag (see 1.2-F8); spring needs an extra explicit "Use spring curve" click                                                                                |
| 5    | Close: ✕ button or window-level Escape                                                               | Escape is swallowed while focus is in any input                                                                                                                                          |

**Step count: 3 interactions minimum from an inspector-centric view (click chip → pick → close), 5 from a timeline-centric view.** The interaction count isn't the worst part — the _context loss_ is:

### 1.2 Friction list (ranked)

- **F1 — Inline expansion destroys context (biggest).** The editor opens as a
  full-width block below the clicked row (`inspector.css` `.kf-row .easing-editor`),
  pushing sibling keyframe rows and subsequent tracks down ~700px in a narrow
  panel. Row↔diamond spatial mapping breaks mid-edit; on short viewports the
  Spring/save sections render off-screen entirely. There is no popover/
  anchored-surface pattern anywhere in the app yet (only the body-portal
  `<datalist>` trick exists).
- **F2 — Easings are invisible everywhere except inside the editor.**
  - Inspector chips are text-only: `ease-in-out-back` vs `ease-out` differ by
    reading, not shape.
  - Timeline diamonds carry zero easing information (`Timeline.tsx` draws
    uniform rotated squares; nothing encodes the segment's curve class).
    Double-clicking a diamond does nothing easing-related.
- **F3 — No motion preview for bezier/preset edits.** Only the Spring section
  has a ball demo. Chrome DevTools fires a preview animation on _every_ change
  ("Any change triggers a ball animation"); here, picking `anticipate` vs
  `settle` shows two similar static curves and you must close and watch the
  main stage (and replay manually).
- **F4 — No comparison.** Choosing between candidate feels means: apply one,
  eyeball, apply other, eyeball, remember what the first felt like. Every
  reference tool treats compare as a first-class mode (§2).
- **F5 — Preset strip hierarchy/density.** 17 built-ins render as one flat,
  wrapping wall of same-sized text chips, then Saved, then Spring presets —
  three visually identical chip rows stacked vertically (~all above the fold
  problem). Families (in/out/in-out/back/overshoot) are unordered alphabetico-
  positional noise. Active-state matching is exact-string only.
- **F6 — Spring is bolted on, with inconsistent commit semantics.** The spring
  section renders permanently expanded regardless of relevance; its params
  mutate only local state until "Use spring curve" — while presets/bezier
  commit instantly. Two mental models in one surface. Generated `linear()`
  strings can't be inspected or tweaked as stops (catalog §3.6 gap).
- **F7 — Library is minimal.** Entries are text-only (no thumbnails), rename =
  re-save over the same name, delete is a 9px hover-only ✕, no import/export,
  and the always-visible name+Save form spends prime vertical space on a rare
  action. Storage is already abstracted behind `makeObjectStorage`
  (`easingLibrary.ts`) so IndexedDB/multi-doc sync is cheap later.
- **F8 — Handle-drag commit contract diverges from the dial.** Bezier handle
  drags call `props.onChange` on **every pointermove**
  (`applyHandles` ← `onCanvasPointerMove`), i.e. one store write per frame.
  The rotation dial established the opposite contract (#68): local preview
  during gesture, exactly one commit on release, Escape cancels. F9 batch ease
  (#84) writes once per keyframe through the normal path. Three surfaces,
  three commit stories — the easing canvas is the odd one out (churns autosave,
  and will churn undo history the day it lands).
- **F9 — Raw input failure is silent.** Typing an invalid cubic-bezier leaves
  the old handles drawn with new text showing; `validate()` accepts `steps(`
  but the editor cannot display or edit steps at all.
- **F10 — Keyboard reach is shallow.** Once open, arrows nudge handles (good),
  but there is no shortcut to open/close the editor from the timeline, and no
  preset cycling via keys (e.g. shift+←/→ walking presets) — AE muscle memory
  has more to offer (F9 variants exist for the track, not per-key).

### 1.3 Recent work that constrains the design

- **#84 overshoot handles + adaptive y-scale.** `bezierYScale()` expands the
  canvas framing when control-point Y leaves [0,1]; draw and pointer/keyboard
  transforms share it so "what you see is what you grab". Any new rendering
  surface (mini-thumbnails, race dots, timeline glyphs, numeric readouts) must
  reuse this logic — a thumbnail that silently clamps Y would misrepresent
  `anticipate`/`overshoot`/`settle`. `evalCubicBezier` now has a bisection
  fallback and is safe to sample densely anywhere.
- **#84 F9 easy-ease per track.** Batch easing exists as a pattern
  (`easingAssistant.ts`, track-header button + F9). New UI should not fork this:
  per-key actions belong in the editor/popover; per-track/per-selection actions
  stay in track headers/shortcuts, eventually generalized by multi-select
  (catalog §2.2). AE parity suggests adding Shift+F9 / Cmd+Shift+F9 → ease-in /
  ease-out variants later.
- **#68 rotation-dial commit-on-release.** Defines the app's drag contract:
  preview locally, commit once on release, Escape cancels. Easing handles
  should adopt it (F8), which also makes future undo coalesce trivially.

---

## 2. Prior-art findings

(Extends inspiration-catalog §3; sources consulted there plus fresh checks of
cubic-bezier.com-class tools and current DevTools docs.)

### 2.1 Chrome DevTools Easing Editor (Elements ▸ Styles)

- **Access = icon at the property.** A small squiggle/swatch icon sits next to
  `transition-timing-function` / `animation-timing-function` / `transition`;
  clicking opens an **anchored popover at that declaration** — never an inline
  page-length expansion. This is the model Keyforge's inspector rows should copy.
- **Ball preview fires on every change**, top of the popover.
- **Keyword picker buttons** (linear/ease-in/ease-out…) separate from **preset
  tables**: descriptive names ("Fast Out Slow In", "In Out Back") grouped under
  keyword families, values shown in the table.
- **linear() stop-graph editing shipped**: click line to add a stop, drag to
  move, double-click to remove; expert linear presets (elastic/bounce/emphasized).
- Cubic-bezier editing stays two-handle only; no speed graph.

### 2.2 cubic-bezier.net (Lea Verou) & modern equivalents

- **Compare is the headline feature**: "Click on a curve to compare it with the
  current one" — selecting a second curve races it against the current in
  side-by-side animated squares, same duration. Modern clones add: duration
  slider for the demo (slow-mo reveals start stutter invisible at 300ms),
  translate/scale/opacity demo modes, red-ghost overlay of the reference curve
  on the same graph, 30+ categorized Penner libraries, copy-to-clipboard.
- Takeaway: candidates-racing is proven demand, and it needs (a) a stable loop
  driver, (b) N labeled lanes, (c) a way to pin candidates without committing.

### 2.3 After Effects Graph Editor

- Value graph vs **speed graph** toggle; Easy Ease (F9) + influence %
  (Keyframe Velocity dialog) for exact numeric reproduction of a feel.
- Translation guardrail already adopted by the catalog (§3.11): speed graph is a
  **read-only lens** in CSS-land — authoring stays bezier because CSS has no
  independent speed representation.

### 2.4 Rive interpolation panel

- Interpolation set per keyframe/selection from an **icon grid** (shape-first,
  names second); default-interpolation preference for new keys; hold/step type
  is a first-class citizen alongside cubic.

### 2.5 Synthesis — what the bar looks like

| Capability                 | DevTools                  | cubic-bezier.net | AE/Rive          | Keyforge today                 |
| -------------------------- | ------------------------- | ---------------- | ---------------- | ------------------------------ |
| Access at the property/key | ✅ popover at declaration | n/a              | ✅ per-key panel | ❌ inline mega-block           |
| Motion preview on change   | ✅ every change           | ✅ looping       | ✅ graph scrub   | ⚠️ spring only                 |
| Compare/race candidates    | ❌                        | ✅ headline      | ⚠️ manual        | ❌                             |
| Visual preset browser      | ✅ named+grouped          | ✅               | ✅ icon grid     | ❌ flat text chips             |
| Numeric handle fields      | ✅ (linear stops)         | ✅ x1y1x2y2      | ✅ influence %   | ⚠️ raw string only             |
| Speed/velocity lens        | ❌                        | ❌               | ✅               | ❌                             |
| steps()/hold support       | ⚠️ keyword only           | ❌               | ✅               | ❌ (accepted but unrenderable) |

---

## 3. Recommended access model (Q1)

**Primary — mini-curve chip → anchored popover (one shared editor instance).**

Upgrade each inspector row's easing chip into a **mini-curve chip**: a ~14–16px
SVG/canvas thumbnail of the current easing (sampled via the existing
`evalCubicBezier` / `parseLinearEasing`, adaptive y-scale reused from
`bezierYScale` so overshoot shapes render true) beside a shortened label.
Clicking opens the redesigned editor as a **popover anchored to the chip**
(body portal like `mountDatalist`, flip/clamp within the panel). Exactly one
editor instance app-wide (single `openEasingEditor(layerId, trackId, kfId)`
signal in the store): opening a second row closes the first, matching DevTools
and killing today's possible stack-of-editors state. Outside-click and Escape
close; `aria-expanded` moves to the chip; focus returns to the chip on close.
This converts the 700px layout shift (F1) into a floating surface and keeps the
row visible while editing — you can watch the value chip and time while shaping.

**Secondary — timeline glyphs + diamond activation.**

Draw a small **easing glyph in each inter-diamond segment** (catalog §3.1):
straight line = linear, S-silhouette = standard bezier, stair = steps, wiggle
hint = spring/overshoot family (sampled from the actual stored string, colored
by track color at reduced alpha). Then wire **double-click (and long-press) on
a diamond** to select it and open the primary popover (scrolled into view);
right-click offers Copy easing / Paste easing / Easy-ease-segment. The timeline
becomes readable (which keys are linear vs eased?) and gains an access point
without duplicating the editor — the popover is still the single surface.
Effort: glyphs M (canvas hit-free drawing, pure draw-path addition),
dbl-click-to-open S.

Rejected alternatives: keeping the single inline editor with "faster access"
only (doesn't fix F1's context loss); putting a full editor on each timeline
row (density + duplicate maintenance); hover-to-open (accidental-open storm).

---

## 4. Editor layout redesign spec (Q2)

What's wrong today (from §1): everything is permanently stacked with equal
weight; presets are text; spring owns permanent real estate; no motion
feedback; no numbers; raw input is the most prominent text element.

Proposed anatomy (fits a ~280–320px popover):

```
┌──────────────────────────────────────────────┐
│ [Curve] [Spring]            ⚑pin  ⭐save  ✕ │  ← mode tabs + header actions
├──────────────────────────────────────────────┤
│ ◉━━━━━━━━━━━━◉   race lane (ghost dots)      │  ← PREVIEW ZONE (always on top)
│ ◉━━━━━━━━━━━━◉                               │     loops current (+candidates)
├──────────────────────────────────────────────┤
│                                              │
│        CURVE CANVAS (120→160px)              │  ← handles / spring curve /
│        (adaptive y-scale)                    │     linear()-stop graph
│                                              │
├──────────────────────────────────────────────┤
│ P1x[0.34] P1y[1.56] P2x[0.64] P2y[1.00]      │  ← numeric fields (live)
│ cubic-bezier(0.34, 1.56, 0.64, 1)   ⧉copy    │  ← raw input demoted to footer
├──────────────────────────────────────────────┤
│ Presets ▾  (grid of mini-curve thumbnails)   │  ← collapsible, grouped:
│  Standard | In/Out | Back/Overshoot |        │     4–6 per row, active ring
│  Saved (★)                                   │
└──────────────────────────────────────────────┘
```

Rationale per zone:

1. **Preview zone first** (F3/F4): 2–4 lanes × 18px, rAF-driven dots using
   `evalCubicBezier`/`sampleSpring` directly (no CSS-animation restart juggling;
   honors `prefers-reduced-motion` by falling back to a static progress marker
   scrubbed by a slow loop or play button). Lane 0 = committed value; lanes 1+
   appear only when candidates are pinned (§5 ghost-race). Doubles as the
   spring demo — one mechanism replaces `.easing-editor__spring-demo`.
2. **Tabs instead of stacked sections** (Q4, F6): Curve and Spring become modes
   of the same canvas. Spring tab keeps perceptual sliders (Duration/Bounce) +
   its presets, plots onto the SAME canvas, and **commits immediately on
   slider release** (same one-write-on-release contract as handles) — deleting
   "Use spring curve" as a separate mental model. Opening a `linear(...)` value
   auto-selects the Spring tab (it parses as stops today); a later stop-graph
   sub-mode (Phase L2) lives here too.
3. **Numeric fields under the canvas** (catalog §3.3): four number inputs bound
   both ways with the handles (type → redraw; drag → reflect). Serves the
   developer audience; enables exact AE-style influence entry. Raw string moves
   to a footer row with a copy button and **visible invalid-state styling**
   (F9) — it remains the escape hatch, not the headline.
4. **Presets as a collapsible visual grid** (F5): each preset renders its own
   mini-curve (same sampler as the row chips), grouped Standard / In-Out /
   Back-Overshoot / Saved, descriptive tooltips with the literal value.
   Collapsed by default after first pick so the canvas dominates; group headers
   teach vocabulary (DevTools naming convention).
5. **Header actions**: Save (opens inline name field in footer, not permanent
   space — fixes F7's space spend), Pin-as-candidate (feeds ghost race),
   Close. Window-level Escape handler stays, scoped to the single instance.

Density budget: popover ≈ 320w × ~420h collapsed-presets vs today's ≥700px
inline column; all controls visible without panel scroll on typical heights.

---

## 5. Ghost-race live comparison (Q3)

**Worth it: yes — recommend building in Phase M2.** It is the single highest-
leverage answer to "which feel do I want?" (the actual question users bring to
this editor), proven headline-grade in this exact domain by cubic-bezier.net,
and cheap once the preview-zone rAF driver exists.

Design: header ⚑ pins the _current_ curve as a candidate lane (max 3 pinned;
oldest evicted). Each lane shows dot + 12px label (preset name or `P1,P2`).
Pins persist per editor session only (no storage schema change). Clicking a
lane's label applies that candidate to the keyframe (compare → adopt is one
click — the workflow the tool exists for).

Cost estimate: **M (~1–1.5 days)**.

- Shared sampling util `sampleEasing(value, t): number` unifying bezier /
  linear-stops / steps-later paths (~40 lines + tests) — also serves row-chip
  thumbnails and timeline glyphs, so it's on the critical path anyway.
- RaceLane component + rAF driver (~120–150 lines): one rAF loop advances
  `t = (now % period)/period` across all lanes; positions are pure function
  calls, no per-frame allocations beyond path strings; pauses on
  `document.hidden`; reduced-motion swaps to a discrete stepped marker.
- Pin state + tests (~30 lines). No store/schema/export changes.
  Risk: none meaningful; perf bounded (≤4 lanes × 60 samples/frame ≈ trivial);
  main care point is not running the loop while the editor is closed.

---

## 6. Library UX improvements (Q5)

Keep persistence seam as-is (`makeObjectStorage` → swap to IndexedDB later).
Improvements, in order:

1. **Thumbnails everywhere**: saved entries render their mini-curve next to the
   name (same sampler as presets/chips) — scannability is the whole point of a
   library.
2. **Save flow moves to header ⭐**: click → inline name field prefilled with a
   smart suggestion (`family-N` derived from nearest builtin, e.g. `back-2`);
   Enter saves, Escape cancels; overwrite prompt if name exists (today it
   silently clobbers via `addEasing`).
3. **Rename + duplicate**: dbl-click name in grid → inline edit (maps to
   remove+add through existing API); hover actions get proper hit areas (≥16px)
   replacing the 9px ✕.
4. **Import/export**: export library as JSON snippet; import pastes it
   (mirrors DocBar's import/export grouping pattern). Cheap now, and required
   groundwork for share-URL embedding (catalog §6.5).
5. **Pin-to-compare from library**: any saved entry's ⚑ adds it as a ghost-race
   lane — the library becomes a palette of candidate feels, not just storage.
6. Later (L): per-project scoping vs global toggle, usage count ("used in 3
   tracks"), dedupe detection on save (identical value already saved under
   another name).

---

## 7. Phased improvements (effort: S ≤ half-day · M ~1–2 days · L ≥ 3 days / epic)

### Phase S1 — feel-the-change fast wins (no structural moves)

| Item                                                                                                                                               | Fixes       | Effort | Notes                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------- |
| Ball/preview loop for ALL easings (extract spring-demo mechanism)                                                                                  | F3          | S      | rAF + `sampleEasing`; reduced-motion fallback; kills the bezier/spring preview asymmetry |
| Commit-on-release for handle drags (dial contract #68): local preview during drag, one write on pointerup, Escape cancels restoring pre-drag value | F8          | S      | aligns three surfaces on one contract; pre-work for undo                                 |
| Mini-curve thumbnails on preset chips + easing chips (read-only first)                                                                             | F2, F5      | S–M    | shared `sampleEasing` + tiny renderer; overshoot-aware y-scale                           |
| Numeric P1/P2 fields bound to handles                                                                                                              | F9-adjacent | S      | catalog §3.3                                                                             |
| Invalid raw-input error state + copy button                                                                                                        | F9          | S      | parse-fail → red ring + hint, keep last-good handles                                     |
| Shift+F9 / Cmd+Shift+F9 = ease-in / ease-out per track                                                                                             | AE parity   | S      | extends `easingAssistant.ts`; update F9 title copy                                       |

### Phase M1 — access + structure

| Item                                                                                                                | Fixes  | Effort | Notes                                                                                          |
| ------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------- |
| Single-instance anchored popover re-platform of EasingEditor (body-portal, flip/clamp, focus return, aria-expanded) | F1     | M      | biggest UX win; establishes reusable Popover primitive                                         |
| Tabbed editor: Curve ⇄ Spring; spring commits on slider release; delete "Use spring curve"                          | F6, Q4 | M      | same canvas both tabs; `linear()` values auto-open Spring tab                                  |
| Preset taxonomy: grouped visual grid, descriptive names/tooltips, collapsible                                       | F5     | M      | metadata on `BUILTIN_PRESETS`; keep exact-match active detection + add normalized-bezier match |
| Timeline easing glyphs between diamonds                                                                             | F2     | M      | catalog §3.1; sampled from stored strings; theme-aware                                         |
| Dbl-click/right-click diamond → select + open popover; Copy/Parse easing actions                                    | F10    | S      | rides popover from item 1                                                                      |

### Phase M2 — comparison

| Item                                                 | Fixes  | Effort | Notes                                            |
| ---------------------------------------------------- | ------ | ------ | ------------------------------------------------ |
| Ghost-race lanes (pin up to 3, click label to adopt) | F4, Q3 | M      | §5 cost estimate; depends on preview-zone driver |

### Phase L — deep capabilities (each its own plan/epic)

| Item                                                                             | Fixes            | Effort | Notes                                                            |
| -------------------------------------------------------------------------------- | ---------------- | ------ | ---------------------------------------------------------------- |
| L1 `linear()` stop-graph editor (add/move/remove stops) on Spring tab            | F6, catalog §3.6 | L      | `parseLinearEasing` exists; canonical round-trip tests mandatory |
| L2 Library manager: rename/dup/import-export/pin-from-library/usage counts       | Q5               | M–L    | items 1–5 of §6 split out if M1 capacity is tight                |
| L3 Read-only speed-graph lens overlay (per-track diagnostic)                     | prior-art gap    | M      | catalog §3.11 guardrail: never authored directly                 |
| L4 steps()/hold support end-to-end (types, glyph, tab, export/import round-trip) | F9               | L      | catalog §3.9                                                     |
| L5 Multi-select batch ease (marquee §2.2 dependency) generalizing F9             | F10              | L      | store selection-set epic first                                   |

Sequencing rationale: S1 removes the daily annoyances without touching
structure; M1's popover is the enabling platform for everything else (tabs,
race lanes, timeline activation all mount into it); M2 is small on top of M1;
L items are independently valuable but each deserves its own researched plan.

---

## 8. Test / QA checklist

Unit (pure functions — follow repo pattern of extracting math to `utils/`):

- [ ] `sampleEasing(value, t)` parity: bezier ↔ `evalCubicBezier`; `linear()`
      stops ↔ parsed spring output; named keywords resolve via
      `BUILTIN_PRESETS`; unknown → null (thumbnail falls back to straight line).
- [ ] Overshoot correctness: thumbnails/glyphs/race dots for `anticipate`
      (min ≈ −0.12 @ ~24%), `overshoot` (≈ +1.10 @ ~57%), `settle`
      (≈ +1.04 @ ~53%) — values outside [0,1] must be represented (scaled or
      guide-lined), never silently clamped (reuse `bezierYScale` semantics).
- [ ] Commit-on-release: handle drag emits exactly ONE `updateKeyframe` write;
      Escape mid-drag restores pre-drag easing; keyboard nudges unchanged.
- [ ] Numeric fields ↔ handles round-trip (type → draw; drag → field text),
      including y outside [0,1].
- [ ] Raw-input validation states: invalid string → error style, last-good
      handles retained; valid paste → handles update; `steps(` → explicit
      unsupported-until-L4 message rather than silent no-op.
- [ ] Spring tab commit: slider release = one write with generated `linear()`;
      no writes while dragging; tab switch preserves draft params.
- [ ] Library: save-overwrite prompts; rename maps to remove+add preserving
      order position; import merges without dupes.
- [ ] Race driver: lane count capped at 4 (current + 3); loop period constant;
      paused when `document.hidden` and when editor closed.

Integration / manual QA:

- [ ] Popover: opens anchored to chip, flips when near panel edge, closes on
      outside-click/Escape/reselect; focus trapped while open; focus returns to
      chip on close; only one instance ever mounted; survives track collapse
      and row reordering underneath it (or closes gracefully).
- [ ] Escape contract regression suite: editor closes from canvas/chip/body
      focus (existing #48 behavior preserved); typing surfaces keep native
      Escape semantics; dial drag Escape-cancel unaffected.
- [ ] Cross-highlight (#82) still scrolls the row into view when keyframe is
      selected from timeline; popover doesn't fight `scrollIntoView`.
- [ ] Timeline glyphs: correct class per easing across all 20 built-ins +
      saved customs; hidden cleanly when zoomed to overlapping diamonds;
      theme-flip repaints (colors from CSS vars only).
- [ ] Reduced motion: preview dots and race lanes degrade per
      `prefers-reduced-motion` (static markers/play button), matching existing
      `.easing-editor__spring-dot` handling.
- [ ] Touch: popover drag of handles works with `touch-action:none` inside the
      floating surface; popover dismiss gestures don't conflict with canvas
      drags; mobile layout (MobileTabs) positions popover within viewport.
- [ ] Theme flip mid-edit repaints canvas + thumbnails (existing `theme()`
      effect pattern).
- [ ] Round-trip: every easing editable in the new UI exports and re-imports
      byte-identically through `export.ts` / `cssImport.ts` (extend
      `roundtrip.test.ts` cases for spring-generated `linear()` applied via
      new commit path).
- [ ] Performance sanity: 200-keyframe doc — popover open < 50ms, glyph pass
      adds < 2ms/frame to timeline draw (measure before/after).

---

## 9. Open questions for owner

1. Popover max width — is widening the inspector panel on popover-open
   acceptable on narrow screens, or clamp-and-scroll inside?
2. Should pinned race candidates persist across editor sessions per project,
   or stay ephemeral (recommendation: ephemeral until share-URL epic)?
3. For timeline glyphs: segment-level (between diamonds, matches CSS semantics
   where easing belongs to the outgoing segment) is recommended — confirm we
   don't want per-diamond badges despite the visual ambiguity.
