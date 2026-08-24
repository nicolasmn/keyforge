# Transform Origin — Implementation Plan (2026-08-24)

> Status: PLAN ONLY (no code changes in this commit)
> Branch: `steward/plan-transform-origin` · Base: `origin/main` @ `30f7627` (#74)
> Scope: (1) a settable per-layer **transform-origin**, and (2) a **debug view** that visualizes it on the preview stage.
> Recommendation up front: Phase A = static per-layer origin + picker overlay + debug view + export wiring. Phase B = animatable `transform-origin` track.

---

## 1. Current-state findings

### 1a. Registry / type system — transform-origin is absent everywhere

| Site                        | Evidence                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AnimatableProperty` union  | `src/types/index.ts:11–21` — 10 properties (`opacity, transform, background-color, color, border-radius, width, height, scale, translate, rotate`). No transform-origin.                                                                                                                                                                                                           |
| Property registry           | `src/utils/propertyRegistry.ts:30–95` — no entry. Reusable pieces: `LENGTH_UNITS` at :28, validation helpers :166–180, value-syntax normalizer `toCssPropertyValue` :127–164 (rotate/translate/scale only).                                                                                                                                                                        |
| Import whitelist            | `src/utils/cssImport.ts:27–38` (`ANIMATABLE`). A `transform-origin` decl **inside @keyframes stops** is parsed (:104–137) then dropped with an "unsupported property" warning (:239–241). Companion element blocks are barely read — only `animation-duration` is sniffed (:151–156) — so an origin authored next to the keyframes is lost on import today.                        |
| Inspector property dropdown | `src/components/Inspector.tsx:60–71` (`PROPERTIES`) rendered at :1203–1215.                                                                                                                                                                                                                                                                                                        |
| Smart first values          | `src/store/index.ts:399–413` (`DEFAULT_FIRST_VALUE`).                                                                                                                                                                                                                                                                                                                              |
| Emission                    | `decl()` (`src/utils/keyframes.ts:33–39`) emits track decls; element rules from `generateCss` (`src/utils/css.ts:44–72`, rule body :60–67) and `layerBlock` (`src/utils/export.ts:26–44`, body :37–42) contain ONLY `animation-*` decls. `transform-origin` appears nowhere in src except `app.css:484` — which is the **stage's own** scale origin (see 1c), unrelated to layers. |

### 1b. Where static CSS lives — and why it round-trips

Static per-element styling is the raw string `LayerElement.initialCss` (`src/types/index.ts:36–40`). Its entire consumer surface:

- **Preview inline styles**: `parseCssString` splits on `;` (`src/components/Preview.tsx:6–16`) and spreads every decl as inline style on the layer div (:118–129). This is the ONLY place initialCss is applied. No other component reads it; there is no UI anywhere to edit it. Writers are factories only: `addLayer` (`src/store/index.ts:426`), `sampleDoc.ts:21,82,129`, `cssImport.ts:268` (hardcoded default).
- **Generated CSS never contains it.** `generateCss` emits @keyframes + animation-* element rules only, so:
  - The CSS panel's editable snapshot (`buildEditableSnapshot` → `generateCss`, `CodeView.tsx:102,207`) has no static styling text, and
  - `commitEditedCss`'s R2 enrichment restores each matched layer's **whole `element` object verbatim** (`src/utils/cssEdit.ts:137`). ⇒ Any structured field added to `LayerElement` survives live-CSS-edit commits for free. R1 rescue (:147–158) likewise clones layers untouched.
- **Persistence never inspects `element`.** `validatePersisted` checks id/name/collapsed/tracks/keyframes (`src/utils/persistence.ts:39–74`) and passes the rest through — an additive field loads unchanged with zero validator work. Precedent for coercion of malformed optionals: `collapsed` at :56.
- **Project duplication shallow-shares `element` by reference.** `cloneDocWithFreshIds` spreads layers but not their element object (`src/utils/projects.ts:292–306`). Harmless while element fields are immutable strings replaced wholesale, but becomes an aliasing hazard once origin is mutable state → one-line fix required (`element: { ...layer.element }`).

### 1c. Preview structure (overlay feasibility)

- `.preview__canvas`: fixed 600×400, `position:relative`, flex-centered children, `var(--color-stage)` bg (`src/styles/app.css:232–242`). It scales to fit via `.split-shell .preview__canvas { transform: scale(var(--preview-scale,1)); transform-origin:center }` (`app.css:482–485`) — that `transform-origin:center` belongs to the STAGE's scaling transform, not to any layer.
- Layer divs get `data-layer-id=slugify(name)` + inline styles from initialCss (+ visibility override) (`Preview.tsx:118–129`); animated values arrive via an injected `<style>` (@keyframes + `[data-layer-id]` rules, paused+infinite; `css.ts:44–72`) scrubbed with negative `animation-delay` (`Preview.tsx:54–59`).
- The style-regeneration memo `docStructure` (`Preview.tsx:24–43`) deliberately tracks only tracks/duration — NOT `element`. Inline styles still update reactively because the JSX reads `layer.element.initialCss` directly inside `<For>`. A new origin merge must simply be part of that same inline-style object (reactive by construction); do not assume `docStructure` fires for it. The debug view needs its own memo that DOES include `element.origin`.
- An absolutely-positioned overlay INSIDE `.preview__canvas` is trivially feasible (sibling after the `<For>`); EmptyState covers the whole preview area when the doc has no layers (`App.tsx:20–28`), so picker/debug UI is naturally gated on `layers.length > 0`.
- Mobile reuses the same `Preview` under the 'preview' tab (`MobileTabs.tsx`, `App.tsx:70–78`) — one implementation serves both.

### 1d. Interplay audit (#68 dial, scale tracks) — what's broken today?

**Nothing in the preview; two gaps elsewhere.**
The preview already applies the full authored cascade including any `transform-origin` present in initialCss (inline style wins; generated rules don't set one). CSS's spec default is `50% 50%` = center, so #68's rotation dial and scale tracks pivot exactly as browsers render them today. Default-vs-spec alignment is correct (`center ≡ 50% 50%`; the app.css:484 center is the canvas wrapper's own origin and irrelevant to layers).

The real gaps are (a) **authoring**: users cannot set an origin at all — rotation/scale around off-center pivots are impossible to author correctly; and (b) **export**: even a hand-authored origin in initialCss would never leave Keyforge (exports emit no static styling — pre-existing gap for ALL static CSS; this plan wires origin specifically, see §6).

One latent inconsistency to note but NOT fix here: exports key the element rule by `layer.id` (`export.ts:37,73`) while preview keys by slugified name (`css.ts:33,60`). Harmless for consumers; relevant only if we ever emit more static decls into exports.

---

## 2. Data model recommendation

**Structured optional field on `LayerElement`; never mirrored into initialCss.**

```ts
export interface OriginPoint {
  x: string
  y: string
} // length-percentage strings: '50%', '0px', '2em'…

export interface LayerElement {
  tag: string
  text?: string
  initialCss: string
  /** Static transform-origin. Absent = CSS default 50% 50%. Two-value form only (v1, no z). */
  origin?: OriginPoint
}
```

Why not store it in `initialCss`:

1. **Round-trip safety favors both, structured wins on clarity.** Both survive `commitEditedCss` (R2 clones the whole element, cssEdit.ts:137). But initialCss has no editor UI and no emission path, so storing there means writing a parser+serializer just to read our own value back — plus ambiguity if user-authored CSS ever declares its own `transform-origin`. Structured = single source of truth with explicit precedence.
2. **Export purity**: one conditional decl in the element rule (§6) vs string-splicing into arbitrary user CSS.
3. **Validation** can follow the `collapsed` coercion precedent (persistence.ts:56): malformed `{x:42}` → field dropped, doc still loads.

Rules:

- Store components **verbatim as authored strings**, validated at write time against `/^-?\d*\.?\d+(%|px|em|rem|vw|vh)$/` per axis. Keywords (`left/top/center`) are UI presets that convert to % before storing.
- New mutations funneling `setDoc` (autosave path, store/index.ts:114–119,148–157):
  - `setLayerOrigin(layerId, x, y)` — writes `{ x, y }`.
  - `clearLayerOrigin(layerId)` — deletes the key entirely so persisted JSON stays clean.
- **No silent normalize-to-default**: once touched, an explicit `50% 50%` stays (WYSIWYG — marker + exported decl visible even at default). Simpler mental model than hidden normalization.
- **Precedence (preview)**: inline-style object spreads `initialCss` first, then visibility, then origin — `...(el.origin ? {'transform-origin': \`${el.origin.x} ${el.origin.y}\`} : {})`. If hand-edited storage ever carries an origin inside initialCss, structured wins. Document this in code.
- **Migration**: none. Optional hardening: drop malformed origins during validatePersisted (Phase A, cheap).
- **Phase B note**: when `transform-origin` becomes an animatable property (registry entry + union member), keep ONE-track-per-property symmetry with `addTrack` (store/index.ts:517–535): if an origin track exists, disable/collapse the static control (track wins everywhere under `animation-fill-mode: both`; the static decl remains the base rule in exports).

---

## 3. Origin picker UX

Entry point — new **“Transform origin” section** in the Inspector, ABOVE the track list (origin changes how every transform/rotate/scale track reads, so it leads):

- Current-value chip (“25% · 80%” or “default · 50% 50%”).
- `[Pick on stage]` toggle button (enters/exits pick mode; Esc also exits; focus returns to the button).
- `⊞ Grid` popover with 9 preset buttons (TL…C…BR) mapping to `(0%/100%, 0%/100%) … (50%, 50%)`; real buttons, aria-label “Set origin top left”, etc.
- X / Y numeric inputs reusing `NumberUnitField` (`Inspector.tsx:333+`): unit `<select>` limited to `% px em rem vw vh` (% default); commit validates against the §2 regex, invalid input reverts via the existing onCancel flow.

Stage overlay (pick mode only):

- Rendered as a sibling **inside `.preview__canvas`** after the layer `<For>` (`Preview.tsx:117–131`): `position:absolute; inset:0`. Mounted only while pick mode is active AND a layer is selected.
- **Coordinate source — offsets, not rects.** Use `el.offsetLeft/offsetTop/offsetWidth/offsetHeight`. These are pre-transform layout values relative to `offsetParent` (= `.preview__canvas`, positioned at app.css:233) — immune BOTH to the ancestor `--preview-scale` scaling AND to the element's own animated transform. `getBoundingClientRect()` would return the post-transform AABB (wrong anchor mid-animation, scaled space) — explicitly avoided.
- **Pointer → % mapping is rect-ratio based and therefore scale-invariant**: with the overlay covering inset:0, `(clientX − overlayRect.left) / overlayRect.width × 100` equals the canvas-layout percentage regardless of current zoom, because numerator and denominator are measured in the same scaled space. Clamp to 0–100, round to 0.1.
- **Gesture contract mirrors RotationDial (#68)** (`Inspector.tsx:186–252`): pointerdown places a local drag-preview signal (crosshair follows pointer; ZERO store writes mid-gesture); pointermove updates the preview; exactly ONE commit happens on pointerup/lostpointercapture; Escape mid-drag cancels and restores the prior origin. Shift constrains to horizontal/vertical axis; within ~2% of a grid preset point, snap (magnet) to it.
- Click-to-place and drag-to-adjust are the same gesture (down = place, move = adjust, up = commit).
- Overlay has `pointer-events:auto` only in pick mode; debug-view markers (§4) are always `pointer-events:none`.
- Touch: handle glyph 12px inside a ≥24px hit target; same flow on the mobile preview tab.

Keyboard & a11y:

- The handle is focusable: `role="slider"` pair semantics — Left/Right adjust X ±1% (Shift ×10), Up/Down adjust Y ±1% (Shift ×10); `aria-valuemin/max=0/100`, `aria-valuetext="origin 25%, 80%"`, plus an `aria-describedby` explaining the axis split. (A single slider role controlling 2D is imperfect; the fully accessible path is the Inspector inputs + preset grid — everything reachable without pointer. Flag for a11y review.)
- Commit announcements via a polite live region in the Inspector origin section (“Origin set to 25% 80%”) — pattern match for CodeView's statusbar (`CodeView.tsx:334–355`).
- Exiting pick mode: Esc, toggle button, selecting another layer (re-targets), or switching tabs.

## 4. Debug view spec

- For each visible layer draw: (a) a **dashed outline of the un-transformed border box** (from the same offset* values), and (b) an **origin crosshair + dot** at `(offsetLeft + x%·offsetWidth, offsetTop + y%·offsetHeight)`. Non-selected layers dimmed (~50% opacity). Drawing the ghost outline is what makes origin-relative geometry legible — you SEE the reference box the % resolve against, even mid-animation.
- Rendering: one SVG absolutely positioned inset:0 inside `.preview__canvas` (px coordinates matching canvas layout space; the ancestor scale transforms it for free). SVG over divs: crisp dashed strokes, one node per layer, trivial crosshair lines.
- Reactivity without rAF: offset boxes ignore transforms, so markers do NOT move during playback — they show where the origin sits on the reference box while the element animates around it (this is the pedagogical point, and it means no per-frame JS). Recompute on: a memo including `layers` + `element.origin` + selection + toggle/pick-mode signals, plus the existing canvas ResizeObserver (`Preview.tsx:100–112`) extended to bump a layout-version signal (panel resizes / initialCss size edits).
- Toggle: **“Show transform origins”** checkbox in the Playback strip next to the snap picker (app.css:262–275 area). Persisted as additive pref `showOrigins?: boolean` in `PersistedPrefs` (persistence.ts:150–155; absent → false, unknown coerced false — same philosophy as theme). While pick mode is active, markers render regardless of the toggle.
- Styling: token-only — selected layer marker `--color-accent`, handle fill `--color-accent-ink`, outlines `--color-text-faint`/`--color-border`. Tokens flip per theme (base.css dark :59–148 / light :156–193) so light+dark both work. Optional subtle pulse gated behind `(prefers-reduced-motion: no-preference)` (precedent motion.css:64); static crosshair otherwise.
- Note: base.css:152–155 cites `src/utils/contrast.test.ts`, which does not exist in the repo (planned in docs/plans/2026-08-24-light-theme.md §QA, never landed). Marker colors use existing checked pairs (accent-on-stage, faint-on-stage) so this doesn't block; flag the contrast CI guard as follow-up.

## 5. Interplay (design question 4 — answered)

See §1d: preview correctness is already satisfied for anything placed in initialCss; after this change the structured origin merges into the same inline styles, keeping rotation-dial (#68) and scale-track previews truthful for off-center pivots. Nothing about the default (center) changes. Export omission was the actual defect (§6).

## 6. Export wiring

- `layerBlock` (`src/utils/export.ts:26–44`): insert conditionally into the element rule after `animation-fill-mode`:

  ```
  ...(layer.element.origin ? [`  transform-origin: ${layer.element.origin.x} ${layer.element.origin.y};`] : []),
  ```

- Mirror the same conditional line in `exportCssReducedMotion`'s reduced companion block (:73–76) for parity — harmless on the opacity-only fallback, keeps anchoring identical.
- **Never inside @keyframes stops** in Phase A (`decl()` untouched). In Phase B, an animated origin track flows through `buildSplitKeyframeBlocks` like any property while the static decl stays in the element rule as the fill base (cascade resolves naturally).
- Purity test: documents without origin must produce byte-identical output before/after the change.

## 7. Phasing

**Phase A — static origin + picker + debug view (one PR)**

1. types: `OriginPoint`, `LayerElement.origin?`.
2. store: `setLayerOrigin` / `clearLayerOrigin` (setDoc funnel → autosave).
3. persistence: malformed-origin coercion in validatePersisted; prefs gain additive `showOrigins` + Playback strip checkbox.
4. projects: copy `element` in `cloneDocWithFreshIds` (aliasing fix).
5. Preview: origin merged into inline styles after initialCss (structured wins).
6. Inspector: Transform-origin section (chip + Pick toggle + preset popover + X/Y NumberUnitFields).
7. Stage: picker overlay (pick mode gesture contract §3) + debug-view SVG (§4).
8. Export: conditional decls in both variants (§6).
9. Tests (§8) + manual QA matrix (themes × reduced-motion × mobile tab × playback scrubbing).

**Phase B — animatable track (separate PR)**

1. `'transform-origin'` joins `AnimatableProperty` + registry meta (`units LENGTH_UNITS`, defaultValue `'50% 50%'`, kind interpolable) + `DEFAULT_FIRST_VALUE`.
2. Tokenizer/chips: today a `"10% 20px"` value falls through to the generic 'string' chip (`tokenize.ts` NUMBER_UNIT_RE :5 is single-value) — needs a dedicated two-component mini-editor (or sub-token split à la transform fns).
3. Interpolation: extend `lerpNumeric` (`interpolate.ts:14–37`) to pairwise-lerp two-component values when units match per-axis; else hold (existing fallback semantics).
4. Import: accept `transform-origin` stops (stop dropping at cssImport.ts:239–241 for this prop; map into a track); optionally map a companion-block origin onto the static field (open question Q4).
5. Timeline row rendering via rowModel; pose-capture benefits automatically through `interpolatedValueAt`.

## 8. Test list (vitest, node env unless noted)

- [ ] store: `setLayerOrigin` writes validated components; `clearLayerOrigin` removes the key; autosave scheduled via the setDoc funnel; unknown layer id is a no-op.
- [ ] persistence: origin round-trips serialize→validate; `{x:'42'}`/missing axes coerce to undefined; legacy blobs unaffected; `showOrigins` pref defaults false, coerces garbage.
- [ ] projects: duplicate project's element is a COPY (mutating dup.origin leaves source untouched).
- [ ] cssEdit: `commitEditedCss` preserves `element.origin` through an edit-commit cycle (R2 assertion); R1 rescue preserves it for hidden/no-keyframes layers.
- [ ] preview merge helper (extract pure `mergeInitialCss(el)`): structured origin overrides a transform-origin declared inside initialCss; visibility override still applies last.
- [ ] picker math (pure `originFromPointer(clientX, clientY, rect)`): clamps 0–100, rounds 0.1, scale-invariance property test (same ratios at arbitrary rect scales).
- [ ] export: element rule contains `transform-origin` iff set (both export variants); unset ⇒ byte-identical to current golden output.
- [ ] registry (Phase B): new meta validates `%`/length units; `toCssPropertyValue` passthrough.
- [ ] interpolate (Phase B): pair-lerp same-unit pairs; unit-mismatch holds; easing applied per segment.
- [ ] import (Phase B): stop-level origin becomes a track; unsupported-property warning no longer fires for it.

Manual QA: both themes; prefers-reduced-motion on/off; mobile preview tab; scrubbing with markers visible; sanity case — origin top-left + rotate 90° pivots around the corner in preview AND matches exported CSS pasted into a scratch page; export→import round-trip behavior documented (companion-block origin silently ignored in Phase A).

## 9. Risks / open questions

- **`position:fixed` in user initialCss** breaks the offsetParent chain (offsetParent → null): detect and fall back to overlay-rect ratio math (still scale-invariant) or hide the picker for that layer with a tooltip hint. Rare (no UI writes position today); handle defensively.
- **Zero-size elements** (width:0): division by zero in %-math → clamp/hide marker, disable picking for that layer.
- **docStructure blind spot**: Preview.tsx:24–43 doesn't track `element` — debug view MUST build its own memo including origin; don't reuse the existing memo as a trigger.
- Percentage origin resolves against the border box; `offsetWidth/Height` ARE border-box dimensions — consistent by construction (test asserts a known geometry case).
- Alias risk if Phase C-ish direct initialCss editing ever lands: precedence (structured wins) is documented now.
- Open Q1: pick-mode multi-layer editing? v1 = selected layer only; toggle shows all layers' markers.
- Open Q2: persist last-used preset as default for new layers? No — absent means default until the user acts.
- Open Q3: z-axis third origin value — out of scope v1.
- Open Q4 (Phase B): should import ALSO map a companion-block `transform-origin` onto the static field instead of/in addition to a track?
