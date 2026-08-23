# Inspector Panel — UX Audit & Improvement Plan

> Status: Proposal (audit of `main` @ ba34aaf)
> Date: 2026-08-23
> Scope: the **Inspector** tab (`src/components/Inspector.tsx`, `src/utils/tokenize.ts`, `src/components/EasingEditor.tsx`, supporting store/utils/styles) plus adjacent behavior it directly feeds (preview/export correctness, keyframe mutation paths).
> Method: full source read + live drive of the running app via Chrome DevTools Protocol (headless Chromium, real mouse/keyboard events), with screenshots of every reachable inspector state. Evidence in Appendix A/B.

---

## 1. Executive summary

The DevTools-token direction is right and largely well executed: chips are visually distinct by type, tap-to-edit works, transform args reassemble losslessly, the easing editor concept (canvas + presets + saved library) is strong. But live testing surfaced **one structural defect that breaks several shipped interactions**, plus a set of correctness bugs and capability gaps:

1. **Every value commit rebuilds every keyframe row's DOM** (Solid `<For>` receives freshly-allocated wrapper objects on each recompute → all rows teardown/recreate). Proven consequences: the easing editor **unmounts mid handle-drag**, closes instantly when a preset is clicked, and the number field **closes on unit change** even though the code explicitly intends to keep it open. This is almost certainly the root cause behind the earlier "drag-scrub has touch bugs" removal — continuous commits destroy the drag source component.
2. Correctness bugs: empty-string values can be committed (produces literal invalid CSS `opacity:;` in preview _and_ export); named easings open an inert easing editor showing a straight line; nonsense units are accepted on any property (`opacity: 0vw`); keyframe times beyond document duration are accepted (>100% stops, silently dropped by browsers); pose-capture "+ KF" captures a held value instead of the visible interpolated pose for transforms/colors, and stores unrounded times.
3. Capability gaps: color editing is a detached native hex-only picker (alpha/oklch destroyed on swatch use; EyeDropper API available but unused); transforms cannot be composed at all (no add/remove/reorder of functions, and no raw-text fallback either); multi-part properties (box-shadow, filter) cannot be tracked or imported.

The plan below sequences fixes so that cheap correctness repairs land first, one structural fix unlocks safe numeric interaction, and then the three big capabilities (color popover, transform stack, multi-part values) build on stabilized foundations.

Effort scale: **S** ≤ 1 day · **M** ≈ 2–3 days · **L** ≥ 1 week (one developer, rough).

---

## 2. What already works (keep)

- Chip visual language per token type (number/color/easing/transform/string colors, fn labels, separators) — reads like DevTools.
- Tap-to-edit with Enter-commit / Escape-cancel / blur-commit; focusout-within-wrapper handling avoids the select-blur bug.
- Transform arg editing: `SubScrub` → `NumberUnitField` → `assembler()` round-trips multi-function values correctly (`translateY(40px)` → edit 40 → string rebuilt). Unit tests cover this.
- Easing library (persisted presets, upsert/delete) and canvas keyboard nudging design (1/2 switch handles, Shift = coarse).
- Datalist rendered into a body portal to escape `overflow:hidden`; iOS-safe `autocomplete="on"` + `list=` combo.
- Mobile `pointer:coarse` overrides exist (44px targets, 16px inputs).
- Autosave via single write path (`setDocWrapped`) — this seam is exactly what an undo system needs later.

---

## 3. Findings

Severity: 🔴 breaks a shipped interaction or corrupts data · 🟠 wrong output / silent data degradation · 🟡 UX gap vs reference editors.

### A. Structural

**F1 🔴 Any changing commit replaces the DOM of every keyframe row.**
`Inspector.tsx` builds `kfTokenPairs` as fresh `{time, kfId, value, easing}` objects inside a reactive getter; Solid's `<For>` diffs by item _reference_, so every store write that changes any keyframe field tears down and recreates all `.kf-row` nodes (verified: identity markers on all 4 rows lost after one changed commit). Everything mounted inside a row dies with it:

- **EasingEditor unmounts mid-drag**: first pointermove whose handles change calls `onChange` → store write → row replaced → `easingOpen` signal gone. Verified: "EDITOR UNMOUNTED DURING DRAG".
- **Preset click kills the editor** (verified: clicking `linear` closed it instantly) — presets are effectively unusable for applying curves interactively.
- **Raw cubic-bezier typing self-destructs** the moment the typed text becomes parseable (`onChange` fires per valid keystroke).
- **Unit change closes NumberUnitField** although the code comment says "commit immediately when unit changes, keep editing open" and even re-focuses the input afterwards (it focuses a dead node). Verified.
- It explains why drag-scrub felt buggy historically: scrubbing = many commits/sec = constant replacement under the pointer.
  Reference: Chrome DevTools Styles panel edits mutate attributes of persistent nodes; Figma panels never rebuild rows on value change.

**F2 🔴 Named easing opens an inert easing editor.**
`parseCubicBezier('ease-out')` returns `null` (regex only matches literal `cubic-bezier(...)`), so `handles()` is null for every named preset: the canvas draws a **straight line instead of the ease-out curve**, hit-testing is disabled, arrow-key nudges do nothing (all verified). Only raw paste / clicking another preset works — and per F1, even that closes the panel. Fix is small: resolve named values through `BUILTIN_PRESETS` before parsing (the same resolution `interpolate.ts#applyEasing` already does).

### B. Correctness

**F3 🔴 Empty value commits corrupt a keyframe.**
Typing garbage into the number field sanitizes to `''` (`type=number`), and `validate('number', …)` accepts `value === ''` — Enter commits `value: ''`. The keyframe then tokenizes as `string`, rendering an invisible zero-content chip, and export emits **`opacity:;`** — verified end-to-end in both the injected preview `<style>` and the CSS tab. The same hole exists via `closeWithNum('','')`.

**F4 🟠 Duplicate `animation-timing-function` at co-timed stops.**
When two tracks have exact keyframes at the same time, `buildKeyframeBlock` emits each track's own timing function into one stop; CSS last-one-wins applies a single easing to **all** properties in that stop. Observed at 0%: `animation-timing-function:ease-out; … animation-timing-function:cubic-bezier(0.34,1.56,…)` — the spring silently wins for opacity too. Adjacent to inspector scope (easing edits feed this), listed here because users will blame the easing chip.

**F5 🟠 Nonsense units accepted on any property.**
`NumberUnitField` offers all 25 unit options regardless of property, and `validate()` passes anything matching `NUMBER_UNIT_RE`. Verified twice: opacity keyframes ended up as `0vw` and `1%`; exported `opacity:0vw` is dropped by the browser with no user feedback.

**F6 🟠 Time values beyond duration accepted.**
Time field validates only `>= 0`. Verified: keyframe at `99999ms` on a 2000ms doc → export emits a `5000%` stop, which browsers ignore. Silent divergence between timeline and output.

**F7 🟡 "+ KF" pose capture mismatches the visible pose for non-number tracks.**
`interpolatedValueAt` lerps only plain number+unit values; transforms/colors fall back to hold. Verified: playhead at ~364ms (preview visibly shows an intermediate translateY), `+ KF` captured `translateY(40px)` — the _previous_ stop, not the pose on screen. Also captured time stored as `363.6363636363636ms` (unrounded).

**F8 🟡 RotationDial never appears where rotation actually lives.**
The dial renders only for `number` tokens with angle units, but the `rotate` track's default value `rotate(0deg)` tokenizes as `transform` — verified `hasDial:false` on a fresh rotate track. The advertised affordance is effectively dead code for its main use case.

**F9 🟠 Duplicate property tracks allowed.**
Nothing prevents adding a second `opacity` track to a layer (verified). Both emit competing declarations into the same stops; last-in-DOM wins. Confusing at best, corrupting at worst.

**F10 🟡 Escape doesn't close the easing editor.**
Spec (`DEVTOOLS-TOKEN-UI.md`) says Escape closes+reverts; verified not implemented in any focus state (chip, body, canvas).

### C. Interaction & capability gaps

**F11 🟠 Color editing is native-hex-only and format-destructive.**
Swatch click creates a detached `<input type=color>`: sRGB-hex picker only; opening it near an `hsl(...)`/`oklch(...)` value and choosing a color writes back hex, destroying format and alpha (oklch+alpha _can_ be entered via the chip's text path — verified `oklch(0.7 0.15 200 / 60%)` round-trips — but the picker path can't preserve it). No popover, no alpha UI, no HSB fields, no eyedropper — although **`EyeDropper` API is available** in the audit browser (feature-detectable). Two different editors depend on whether you hit the 10px swatch (native picker) or the label (text input) — undiscoverable split-brain. Completions list is named-colors only.

**F12 🔴 Transforms cannot be composed.**
`open()` early-returns for transform tokens: no add/remove/**reorder** of functions, and **no raw-text fallback either** — `CSS_TRANSFORM_COMPLETIONS` is unreachable dead code. The only ways to author `translateY(40px) rotate(45deg)` today are CSS import or JSON import. This contradicts the mental model of every reference tool (DevTools/Figma show editable stacks).

**F13 🟠 Multi-part values unsupported entirely.**
`PROPERTIES`/`ANIMATABLE` is a fixed list of ten; box-shadow/filter/clip-path/gradients are rejected at add-track _and_ at CSS import ("unsupported property skipped"). Note: since Keyforge exports real CSS stops, **browsers would interpolate box-shadow/filter natively today** if these were merely trackable — the gap is tokenizer/UI, not export math.

**F14 🟡 Numbers lack safe scrubbing, arrows-at-rest, and steppers.**
Drag-scrub was deliberately removed (touch bugs); today the only increment affordances are: open the editor → native `type=number` arrows (integer step=1 always — verified 0→3 after three ArrowUps, regardless of context) — and hidden spinners mean mouse users get nothing. Reference editors (DevTools, Figma) all offer drag-scrub + arrow keys on the _resting_ control.

**F15 🟡 Validation feedback is generic and inconsistent.**
Red border only while editing; error `title`s not property-aware (spec'd, never built); invalid-commit semantics differ by path (`close()` re-commits the old value, `closeWithNum()` commits nothing, empty number _commits_ per F3); no `aria-live` announcement of revert; mid-typing flashes red on partially-valid input like `oklch(0`.

**F16 🟡 Keyboard flows incomplete.**
No Tab/Shift+Tab token chaining (spec'd; existed only in removed prototype); no `[`/`]` jump between keyframe stops (open task in PLAN.md); Escape contract inconsistent (F10).

**F17 🟡 No undo anywhere.**
All commits are immediate; ✕ deletes a keyframe irreversibly with no confirmation. Every planned feature above (scrub! stack reorder!) amplifies the need.

**F18 🟡 Add-track is a bare native select** with fixed options, no search, no duplicate guard (F9), and no indication that more properties exist behind CSS import.

---

## 4. Improvement plan

Ordering principle: **correctness before capability**; F1's fix unlocks three later items; each item lists dependencies. IDs referenced from §5 roadmap.

---

### P0-1 · Stable row identity (fixes F1) — **M**

**Problem.** See F1. Single highest-leverage fix in the file.

**Proposal.** Stop rebuilding wrapper objects reactively. Pass the **store's stable keyframe proxies** through `<For>`, and let `KeyframeRow` derive display state via getters:

```tsx
<For each={l().tracks}>{(track) =>
  <TrackSection track={track} …>
    <For each={track.keyframes}>            {/* stable proxy references */}
      {(kf) => <KeyframeRow kf={kf} track={track} layerId={…} />}
```

Inside `KeyframeRow`, compute `const valueToken = createMemo(() => tokenizeOne(kf.value, kf.easing, path))` (a per-row slice of today's `tokenizeLayer`). `ValueChip`/`SubScrub`/`EasingEditor` keep their current props contracts (`token.value` becomes `token.value()` internally or props stay memoized). Solid updates only the changed text nodes; row components — and their signals (`editing`, `easingOpen`) — survive every commit. `keyframes.sort()` inside `updateKeyframe` remains fine: `<For>` moves existing nodes on order changes instead of recreating them.

**Mapping.** Pure Inspector.tsx restructuring; `tokenize.ts` gains an exported single-keyframe entry point (thin refactor of the loop body; `tokenizeLayer` kept as composition for tests/CSS-import previews). No store schema change. Existing assembler/SubScrub untouched.

**Edge cases.** Rows must still react when a keyframe object is _replaced_ (import/reset) — `replaceDoc` uses `reconcile`, which preserves node identity where shape matches; verify `For` drops removed ids. Add a regression test asserting `easingOpen` survives a value commit (can be asserted indirectly once Playwright lands; until then a vitest on the pairs-building function returning stable refs).

**Unlocks.** N1 (scrub), T1 (stack interactions feel right), K1 (keyboard chaining), V1 (live validation without churn).

---

### P0-2 · Resolve named easings in EasingEditor (fixes F2, F10-partial) — **S**

**Proposal.** In `EasingEditor`, replace direct `parseCubicBezier(value)` with `resolveEasing(value)`: named lookup in `BUILTIN_PRESETS` → its bezier; `linear` → null-but-valid; else parse literal. Draw the resolved curve immediately; dragging converts the stored value to explicit `cubic-bezier(...)` (current behavior, good — matches how DevTools materializes keyword easings on edit). While in named form, show a small badge "ease-out" over the curve so users know conversion happens on first drag.
Also honor the spec'd Escape contract here: Escape closes the panel and restores the easing that was set when it opened (snapshot `initialValue`; compare-and-noop if unchanged).

**Mapping.** `utils/easing-presets.ts` gains `resolveEasing` (+ tests mirroring `applyEasing` cases). `EasingEditor.tsx` seeds `handles()` from the resolver. ~30 LOC total.

**Depends on:** nothing. Should land before P1-3 so preset/drag testing is meaningful.

---

### P0-3 · Validation guardrails: never commit empty/garbage (fixes F3, part of F15) — **S**

**Proposal.**

1. `validate('number', v)` loses its `value === ''` escape hatch; whitespace trims before checks everywhere.
2. Uniform close semantics across `close()`, `closeWithNum()`, `SubScrub.commitSub()`: **invalid or empty input ⇒ no store write, red border flash (250ms) after close, restore previous value.** Today's three divergent behaviors collapse into one rule: _empty means cancel._
3. `KeyframeRow.commitTime`: clamp to `[0, doc.duration]` (silently clamping with a flash beats rejecting; also fixes F6's worst case), reject NaN.
4. Announce reverts politely: one shared `aria-live="polite"` region in the inspector ("Reverted: 'abc' is not a valid number").

**Mapping.** All within Inspector.tsx helpers; add table-driven tests alongside tokenize tests. No new architecture.

**Depends on:** nothing.

---

### P0-4 · Property metadata registry — foundation for units/validation (fixes F5, F9, F18-partial) — **M**

**Proposal.** New `src/utils/propertyMeta.ts` (single source consumed by Inspector _and_ cssImport, replacing the duplicated `PROPERTIES`/`ANIMATABLE` arrays):

```ts
interface PropertyMeta {
  prop: AnimatableProperty
  label: string
  kind: 'number' | 'length' | 'angle' | 'percentage' | 'color' | 'transform' | 'unitless'
  units: readonly string[] // allowlist fed to NumberUnitField's <select>
  step: number // scrub/arrow granularity
  range?: [min, max] // amber-warn outside (opacity 0..1)
  examples: string[] // placeholder + datalist seeds
  validate?(v: string): boolean // optional stricter check
}
export const PROPERTY_META: Record<AnimatableProperty, PropertyMeta>
```

Behavioral changes riding on it:

- `NumberUnitField` receives filtered `units`; unit `<select>` shows only sensible ones (`opacity`: unitless only; `rotate` args: deg/rad/turn/grad; `width`: length/%). If the _current_ unit isn't in the allowlist, keep it in the list but flag amber.
- Range warnings render **amber** (distinct from red=invalid): `opacity: 1.4` is legal CSS but likely unintended.
- Add-track select groups by kind with a search-as-you-type variant deferred (keep native `<select>` for now; duplicates of an existing track get a ⚠ inline warning instead of hard block — some workflows genuinely want two width tracks? No — block exact duplicates, message "opacity track already exists").

**Mapping.** New util + thin wiring; `completionsFor` refactors to consume meta examples. cssImport imports the same list (kills drift risk flagged in F13 groundwork).

**Depends on:** nothing. **Feeds:** N1 (steps), N2 (units), V1 (messages), M1 (registry pattern).

---

### P1-1 · Color popover picker (fixes F11) — **L**

**Problem.** Native detached `<input type=color>`: hex-only, alpha/format destroying, undiscoverable dual-editors, no eyedropper despite API availability.

**UI sketch.**

```
        ┌────────────────────────────────────────┐
        │ oklch(0.7 0.15 200 / 60%)      [✕]      │   ← raw value, editable, live-updates widgets
        │ ┌──────────────────────────────┐        │
        │ │                              │ [▲]    │   ← SV square (saturation × value)
        │ │        saturation/value      │ [Hue]  │   ← vertical hue slider
        │ │                              │        │
        │ └──────────────────────────────┘        │
        │ alpha ▬▬▬▬▬▬▬●▬▬▬▬ 60%                  │   ← checkerboard-backed slider
        │ H 200   S 15%   L 70%    A 60%          │   ← channel number chips (reuse SubScrub!)
        │ [#11AABB99] [rgb(17,170,187,.6)] [copy] │   ← derived formats, click to convert-to
        │ [💧 Eyedropper]   [swatches: theme ▾]   │   ← button only when EyeDropper exists
        └────────────────────────────────────────┘
```

Rendered as a popover anchored to the clicked chip inside `.inspector__body` (absolute positioning + flip when near panel edges — the panel is narrow, so prefer **opening below the row full-panel-width** like EasingEditor already does; that dodges z-index/clipping entirely and stays consistent with the easing precedent).

**Interaction model.**

- Clicking **anywhere on the color chip** opens the popover (kills the swatch-vs-label split brain). The swatch enlarges slightly on hover as affordance.
- Channel chips (H/S/L/A or R/G/B/A depending on format tab) are **existing SubScrub-style chips** — tap to type, arrows to nudge, unit-suffix labels (% / °). Drag-scrub on them comes free with N1 later.
- Format tabs (hex | rgb | hsl | oklch) switch the widget set; oklch tab shows L/C/H sliders mapped through gamut-clamped preview.
- **Format preservation policy (important):** editing channels rewrites _the authored format_ (`hsl(264 80% 68%)` stays hsl; hex stays hex, expanding to `#RRGGBBAA` only when alpha ≠ 1). Converting formats is explicit (click a derived-format row). Named colors / keywords (`transparent`, `currentColor`): swatch shows resolved color; first channel edit expands to the nearest structured format (named→hex, `transparent`→`rgba(0,0,0,0)`), with the original keyword offered in a "restore" row. Relative-color syntax (`rgb(from red …)`) renders read-only with an info note (v1).
- Eyedropper: `typeof EyeDropper !== 'undefined'` gate; `await new EyeDropper().open()` → commit picked sRGB into current format; catch `AbortError` silently. Headless/dev environments without the API simply don't render the button.
- Live preview while adjusting: commit on rAF-throttle (cheap now post-P0-1), final commit on close; Escape cancels back to opening value.

**Parsing architecture.** New `src/utils/colorParse.ts`: `parseCssColor(v) → { format, channels{h,s,l,a|…}, cssText }` using `getComputedStyle` probe trick already present in `ColorSwatch` for resolution, plus regex extraction per format for _authoring_ fidelity. Gamut mapping for out-of-oklch displays: clamp via `color-mix(in oklch, …)` fallback or Canvas `fillStyle` normalization (same probe).

**Edge cases.** Alpha in legacy comma syntax (`rgba(0,0,0,.5)`) ↔ modern space syntax round-trip; `%` vs 0–1 alpha; hue wraps at 360; S/L sliders in oklch ≠ hsl sliders (label them); very narrow inspector (<260px): popover goes full-width below row; two popovers open simultaneously — enforce one-open-at-a-time like easing editor.

**Mapping.** New component `ColorPopover.tsx` + `colorParse.ts`; `ColorSwatch` shrinks to a dumb swatch; ValueChip color branch routes onClick → popover toggle. Tokenizer untouched (still detects `color`). Effort L mostly due to parser fidelity + gamut edges, not UI.

**Depends on:** P0-1 strongly (live-update feel), P0-4 (examples/validation messaging reuse). Ship order within P1: parser+tests first (pure), then UI.

---

### P1-2 · Transform stack composer (fixes F12) — **L**

**Problem.** Functions can't be added/removed/reordered; no raw-text fallback exists either.

**UI sketch.**

At rest, unchanged (grouped chips). Clicking the **fn label or any whitespace in the transform chip** (post-P0-1 this can also be an explicit chevron) expands an inline stack card below the row, mirroring EasingEditor's placement convention:

```
transform                                    ⇅ = drag handle (phase 2), ✕ = remove
┌──────────────────────────────────────────────┐
│ ⇅  translateY( [40] [px▾] )               ✕  │
│ ⇅  rotate(    [45] [deg▾] )               ✕  │
├──────────────────────────────────────────────┤
│ [+ Add function…]  search: rot▁              │
│   ├ rotate      rotateX      rotateY         │
│   ├ scale       scaleX       scaleY          │
│   ├ translate   translate3d  skew  …         │
│   └ perspective matrix       (recent)        │
└──────────────────────────────────────────────┘
```

- Each function row: name (clickable → tiny menu to swap to sibling fn, e.g. rotate→rotateX keeps arg count where possible), argument sub-token chips = **existing SubScrub components verbatim**, remove ✕.
- **Add function** opens searchable menu grouped by category (move/scale/rotate/skew/3D/other); inserting uses `DEFAULT_FN_ARGS` table (`translate: 'translate(0px, 0px)'`, `rotate: 'rotate(0deg)'`, …) appended at stack end; new row gets a brief highlight pulse so you see what appeared.
- **Reordering phase 1 = buttons**: ↑/↓ micro-buttons on hover per row (touch-friendly, deterministic). Phase 2 = HTML5-free pointer-based drag via the same pattern LayerTree already uses (`@thisbeyond/solid-dnd` is already a dependency — reuse `DragDropSensors` locally).
- **Raw-text escape hatch** (also fixes the dead completions): footer link "edit raw" swaps the card body for the standard chip text-input with `list=CSS_TRANSFORM_COMPLETIONS`; validate with `CSS.supports('transform', v)` + tokenizer re-parse on commit; malformed input keeps card open in red state.

**Data model decision (keeps lossless principle).** `kf.value` remains a **flat string** — the stack view is a projection. New pure utils in `src/utils/transformStack.ts`:

```ts
splitTransformFns(v: string): { fn: string; argsRaw: string }[]
rebuildTransform(fns): string                       // joins with ' '
moveTransformFn(v: string, from: number, to: number): string
removeTransformFn(v: string, i: number): string
appendTransformFn(v: string, defaultValue: string): string
```

Every UI op = one pure string rebuild = **one `updateKeyframe` commit** (undo-friendly, autosave-friendly, round-trip-safe with import/export). The existing `argIndex = fnIndex*100+argInFn` encoding keeps working since grouping derives from the rebuilt string each render.

**Edge cases.** `matrix(1,0,0,1,0,0)` six args render as six sub-chips (fine); unknown/unparseable segments (e.g. `var(--x)`) render as a read-only amber string chip with "edit raw" hint rather than being silently dropped (today's tokenizer would lose them — add a tokenizer warning channel); whitespace normalization on rebuild (`translateY(40px) rotate(45deg)` single-space join); duplicate functions allowed (legal CSS, additive intent); swapping `translate`↔`translate3d` maps args positionally, truncating/padding with defaults.

**Tests.** `transformStack.test.ts` mirroring tokenize.test style — move/remove/append round-trips, weird spacing, nested parens safety (regex operates on balanced top-level fns; document limitation for `calc()` inside args → falls into "unknown segment" path).

**Depends on:** P0-1 (rows must survive the commit each op makes), P0-4 (per-fn unit filtering for args). Pure utils themselves can land immediately (no deps).

---

### P2-1 · Safe number scrubbing + resting-state keyboard (fixes F14) — **M**

**Problem.** No drag-scrub (removed for touch bugs — root cause now understood, see F1); no increments without opening the editor; hidden spinners leave mouse users nothing.

**Design principles.** Tap must stay tap (mobile-first muscle memory is already shipped); scrub must be opt-in per gesture, impossible to trigger accidentally; every gesture cancellable.

**Interaction spec.**

_Pointer (mouse/pen only):_

1. `pointerdown` on a **resting number chip** records start point/time; no visual change yet.
2. Movement ≥ 4px while pressed ⇒ enter scrub: `setPointerCapture(pointerId)` on the chip (captures drags leaving the 20px chip — this alone kills the old class of touch bugs where the pointer left mid-gesture), cursor → `ew-resize`, chip shows subtle pressed background.
3. Horizontal delta → value delta at `PROPERTY_META.step` per px; **Shift = ×10, Alt = ÷10** (DevTools convention); live-commits throttled to animation frames (store write per frame is fine post-P0-1; autosave debounce already coalesces).
4. `pointerup` ⇒ final commit. **Escape mid-drag** ⇒ restore start value, cancel capture.
5. `pointerType === 'touch'` ⇒ scrub disabled entirely in v1; long-press-to-scrub considered later behind a flag (tap-to-edit latency is sacred on mobile).
6. Gesture arbitration: if released within threshold+300ms ⇒ synthesize the normal tap → open inline editor (preserves today's flow exactly).

_Keyboard (resting chip, focused via Tab):_

- ←/→ (or ↑/↓) nudge by `step` (×10 Shift, ÷10 Alt), committing per press — matches DevTools; Home/End jump to range bounds when `range` defined.
- Enter still opens full editor; typing a digit while focused could pre-open editor seeded with that digit (stretch).

_Steppers:_ defer visible ▲▼ buttons (dense 22px rows get crowded; arrows+scrub cover desktop, mobile has the editor). Revisit if telemetry shows demand.

**Edge cases.** Scrubbing a value with `%`/viewport units: deltas are abstract units (document in tooltip: "±1% per px"); angle chips scrub degrees with dial updating (fixes F8 visibility incidentally — also render mini-dial inside SubScrub rest state when unit is angle); scrubbing clamps to `range` with soft resistance at bounds (opacity sticks at 1); multiple rapid gestures produce one undo entry each (U1 coalescing handles the per-frame storm).

**Mapping.** New `useScrubber(pointerHandlers)` helper composable used by both `ValueChip` (number rest state) and `SubScrub`; commits go through existing `commit(path, value)`. Needs P0-1 (component survival during rapid commits), P0-4 (step/range), U1 recommended (gesture = one undo entry).

**Tests.** Pointer-event unit-ish tests via happy-dom are weak for pointer capture; defer e2e to Playwright milestone; manually verify the three historical touch failure modes (finger leaves chip, second finger taps, page scroll during drag — `touch-action: none` applied only during active mouse/pen scrub, never on touch).

---

### P2-2 · Multi-part values framework: shadows → filters (fixes F13) — **L (phased)**

**Why this is cheaper than it looks.** Export/preview interpolate composite properties natively once they're emitted as real CSS (they already are, per-stop). The work is: make such properties trackable + tokenizable + editable. Gradients are explicitly **out of scope** for this phase (stop-level gradient editing is its own epic).

**Architecture proposal.**

1. **Registry extension** (builds on P0-4): `COMPOSITE_PROPS: Record<string, CompositeMeta>` where each entry provides:
   - `splitParts(value) → Part[]` (comma-aware, paren-depth-aware splitting),
   - `parsePart(part) → Component[]` where `Component = { type:'number'|'angle'|'color'|'keyword', value, unit?, assembler-slot }`,
   - `defaults: string[]` (e.g. shadow: `'0px 2px 8px rgb(0 0 0 / 35%)'`),
   - `shapeKey(parts) → string` for cross-keyframe compatibility warnings.
2. **Tokenizer generalization:** `detectType` gains `'composite'` (or reuse `'transform'` machinery renamed `'functions'`); `SubToken` grows `partIndex` and widens `type` beyond `'number'` (colors inside shadows!). The `assembler` closure pattern already solves reconstruction — generalize to parts. **This is the core architectural stretch: SubToken stops being transform-only.** Rename to `ValueComponent` in types (keeping alias for migration).
3. **Inspector rendering:** each part renders as a chip-group row visually identical to transform fn-groups (`0px [2px] [8px] ▪rgb(0 0 0/35%) inset`), stacked parts separated by `,`; part-level ops (add part = duplicate last with defaults, remove, reorder ↑↓ — mirrors T1's phase-1 buttons; drag unify later). Color components open ColorPopover (P1-1) inline.
4. **Trackable properties added** (via registry, single source): `box-shadow`, `filter` (blur/brightness/contrast/etc. map exactly onto the fn-group UI — filters ARE transform-like function stacks, so T1's stack composer components reuse directly), `outline-offset`-style simple ones come free as plain numbers. `clip-path` deferred (vertex-matching problem deserves its own spec). Gradients deferred.
5. **Cross-keyframe shape validation:** warn (amber, non-blocking) when a track's keyframes have mismatched shapes ("shadow count differs between 0ms and 1000ms — CSS will step instead of animate"). This is honest about CSS reality and prevents silent confusion.
6. **Pose capture upgrade** (fixes F7 properly): extend `interpolatedValueAt` to lerp composite parts numerically/color-wise when `shapeKey` matches (numbers lerp, colors lerp in oklab via short path, keywords must match else hold). Phase this — hold-capture acceptable initially but _rounded times_ land immediately (P0-3 covers clamping; rounding to integer ms belongs here too).

**Phasing.**

- M-a: registry + composite tokenizer + read-only rich rendering + box-shadow trackable (S-ish each once pattern exists; whole step M)
- M-b: editable components (SubScrub generalization + part ops) (M)
- M-c: filters via reused stack-composer UI (M)
- M-d: shape validation + composite pose capture (M)

**Edge cases.** Multiple shadows comma-splitting vs commas inside `rgb(r,g,b)` (paren-depth splitter required — write it once, test heavily); `inset` keyword position variance (normalize to front on rebuild, preserving author order otherwise); `filter: url(#svg)` → opaque keyword-chip; performance: tokenize per keystroke is fine (small strings) but cache parsed parts per kf.id+value in a WeakMap to avoid re-parsing unchanged rows.

**Depends on:** P0-1, P0-4; benefits from P1-1 (color components), T1 (shared stack ops). No export/store changes required — emphasize: **kf.value stays a flat string throughout**, preserving the lossless round-trip guarantee (#32/#33).

---

### P2-3 · Keyboard flows & consistency polish (fixes F10, F16) — **M**

Bundle of small, spec'd-but-unbuilt items; sequence after P0-1 (chaining requires surviving focus targets):

1. **Tab/Shift+Tab token chaining** within document order: time → value sub-tokens → easing → next row. Implement as focus-manager: each chip registers `(rowIndex, tokenOrdinal)`; Tab handler advances programmatically (`el.focus()`), wrapping at panel end. Restore the removed prototype's logic conceptually; chips are already `tabindex=0`.
2. **`[` / `]` jump** to same token in prev/next keyframe stop of the same track (opens its editor focused) — spec'd in DEVTOOLS-TOKEN-UI.md, still an open task.
3. **Uniform Escape contract** across every editor (number field, chip text, color popover, easing editor, stack card): cancel/close, restore opening value, return focus to the owning chip. Central `useEditorLifecycle()` helper so the five call sites can't drift again.
4. **Delete key on focused row** removes keyframe with toast + Undo (requires U1; otherwise confirm dialog interim).
5. Document the map in a `docs/KEYBOARD.md` stub once shipped (developer-audience product principle #4).

**Depends on:** P0-1; U1 for item 4.

---

### P2-4 · Export correctness: per-property easing at co-timed stops (fixes F4) — **M** _(adjacent)_

Not strictly inspector UI, but easing-chip edits feed this and users will misread it as an inspector bug. Proposal: in `buildKeyframeBlock`, group a stop's declarations by their timing function and emit **sibling blocks at the same percentage** (`0% { opacity:0; animation-timing-function:ease-out }` + `0% { transform:…; animation-timing-function:cubic-bezier(…) }`) — legal CSS, cascades correctly, and round-trips through the importer unchanged (its per-prop timing pairing already supports it). Update `roundtrip.test.ts` accordingly. Coordinate with whichever QA pass follows; low user-visible risk, high correctness win.

---

### P3-1 · Undo/redo (fixes F17) — **M/L**

**Why the architecture is ready:** every mutation funnels through `setDocWrapped` (store comment says so, and it's enforced by convention). Wrap it:

```ts
const undoStack: { label: string; before: AnimationDocument; after: AnimationDocument }[] = []
function setDocTracked(updater, label) {
  const before = JSON.parse(JSON.stringify(doc)) // docs are tiny (few KB)
  setDocRaw(updater)
  scheduleSave()
  pushCoalesced({ label, before, after: snapshot() })
}
```

- **Coalescing:** consecutive entries with same `{layerId,trackId,keyframeId,field}` within 800ms merge (typing feels like one edit); scrub gestures flush-coalesce on pointerup (N1 dependency, soft).
- `replaceDoc` (import/reset) pushes a labeled entry ("Import CSS"); cap stack at 50.
- Cmd/Ctrl+Z / Shift+Cmd+Z global handler (skip when target is a text input mid-composition); DocBar gains Undo/Redo buttons with disabled states.
- Toast on destructive actions ("Keyframe removed — Undo") reuses the same stack.

**Risks:** snapshot cloning cost trivial at current doc sizes; memory bounded by cap. Don't attempt command-pattern granularity — snapshots match the "doc is small, mutations frequent" reality.

**Depends on:** nothing technically; **land before or with N1** so scrub bursts collapse cleanly.

---

### P3-2 · Small polish batch — **S each**

- **F8**: render mini RotationDial inside SubScrub rest-chip when unit is angle (dial becomes universally visible where angles live).
- **F7-partial**: round captured pose times to integer ms on `+ KF`.
- **F9**: block exact-duplicate property tracks (P0-4 wiring).
- **F18**: add-track select gains optgroups by kind (from PROPERTY_META); search variant deferred until >15 properties.
- **F15-residual**: property-aware validation messages from PROPERTY_META (`title` attr + aria-live), amber-vs-red severity classes (`--color-warn` token needed in base.css).
- **F10** remainder covered in P2-3.3.
- Empty-track hint copy: currently "No keyframes — tap + KF to add"; make `+ KF` a button there too (bigger target than the header pill on mobile).

---

## 5. Sequencing & dependency graph

```
P0-1 stable identity ──┬─► P2-1 scrub/arrows ──► (coalesces with) P3-1 undo
                       ├─► P1-2 transform stack ───► P2-2 filters (reuses stack UI)
                       └─► P2-3 keyboard flows
P0-2 named easings ────► (before P1-1/P1-2 QA passes; standalone)
P0-3 validation guards (standalone)
P0-4 property meta ─┬─► P1-1 color popover (soft dep)
                    ├─► P1-2 (arg unit filtering)
                    └─► P2-2 composite registry
P2-4 export easing fix (standalone, anytime)
```

| Sprint | Items                                                   | Theme                                                                  |
| ------ | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1      | P0-1, P0-2, P0-3                                        | Stop the bleeding: rows survive, easing editor works, nothing corrupts |
| 2      | P0-4, P3-2 batch, P2-4                                  | Metadata foundation + small correctness/polish wins                    |
| 3      | P1-1 color popover (parser → UI)                        | Color reaches parity with modern editors                               |
| 4      | P1-2 transform stack (utils → UI)                       | Composition unlocked                                                   |
| 5      | P2-1 scrub + resting arrows (+ P3-1 undo if not sooner) | Numeric UX restored, safely                                            |
| 6+     | P2-2 phases a–d, P2-3 bundle                            | Multi-part values, keyboard depth                                      |

Each sprint ends shippable; P0 items are individually releasable hotfix-grade (P0-2 and P0-3 could ride along in any PR).

---

## 6. Testing notes

- Unit (Vitest, existing patterns): `transformStack.test.ts`, `colorParse.test.ts` (format preservation matrix incl. alpha/legacy syntax), composite splitters (paren-depth comma case!), `resolveEasing`, validation-guard table tests, `propertyMeta` completeness against ANIMATABLE.
- Round-trip: extend `roundtrip.test.ts` for P2-4 sibling-block emission and composite props once tracked.
- E2E (when Playwright lands per PLAN.md): golden-path script reproducing this audit's scenarios (edit number → unit change keeps editor open; preset click keeps editor open; empty commit reverts; oklch+alpha survives swatch edit; add rotate fn to translateY).
- Manual matrix: pointer:coarse run-through after P2-1 (three historical touch failure modes) and after P1-1 popover (narrow panel, iOS zoom rules — keep 16px font-size on popover inputs).

---

## Appendix A — Live-test evidence log (CDP scenarios, headless Chromium @ localhost:3000)

| #   | Action                                              | Result                                                                                    |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Open number editor (opacity KF1)                    | Field opens focused, value selected; unit select = 25 options                             |
| 2   | 3× ArrowUp in field                                 | 0 → 3 (native integer step, no context awareness)                                         |
| 3   | Type `abc`, Enter                                   | Sanitized to `''` → **committed** → invisible string chip; CSS tab shows `opacity:;` (F3) |
| 4   | Row DOM markers → changed commit                    | All markers lost (F1)                                                                     |
| 5   | Easing chip click (isolated)                        | Editor opens; canvas shows **straight line** for ease-out (F2)                            |
| 6   | Bezier handle drag (spring value)                   | First changing move unmounts editor (F1 consequence)                                      |
| 7   | Preset click (`linear`)                             | Editor closes instantly (F1 consequence)                                                  |
| 8   | Unit → vw on opacity                                | Commits `0vw`; **field closes** though code intends keep-open (F5, F1)                    |
| 9   | Type `oklch(0.7 0.15 200 / 60%)` via chip text path | Commits fine, swatch renders alpha (good path worth keeping)                              |
| 10  | Swatch click (native picker)                        | Detached-input hack; headless shows nothing; hex-only by construction (F11)               |
| 11  | `EyeDropper in window`                              | **true** — API available, unused (F11)                                                    |
| 12  | + KF at playhead ~364ms (transform track)           | Captures held `translateY(40px)`, time `363.6363636363636ms` (F7)                         |
| 13  | rotate track default value                          | No RotationDial (`hasDial:false`) (F8)                                                    |
| 14  | Time edit → 99999                                   | Accepted; export gains >100% stop (F6)                                                    |
| 15  | Second `opacity` track                              | Allowed silently (F9)                                                                     |
| 16  | Escape vs easing editor (3 focus states)            | Never closes (F10)                                                                        |
| 17  | Raw easing input typing                             | Survives _only_ while parse fails; will die when parseable (F1)                           |

## Appendix B — Screenshot inventory (`/tmp/shots/`)

`01-default-overview` · `02-number-editing-open` · `03-number-invalid-attempt` · `04-transform-subtoken-editing` · `05-css-tab-after-empty-commit` (visible `opacity:;`) · `06-color-track-default` · `07-swatch-clicked-native-picker-headless` · `08-color-text-oklch-typed` · `09-color-oklch-committed` · `10b-easing-editor-open` (**straight line** for ease-out) · `13-rotate-track-dial` (absent) · `14-easing-edited` · `16-after-preset-click` (editor gone)

---

_End of plan. File intentionally left uncommitted; worktree clean apart from this document._
