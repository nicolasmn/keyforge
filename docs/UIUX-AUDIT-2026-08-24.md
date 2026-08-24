# Keyforge — Whole-App UI/UX Polish Audit

> Date: 2026-08-24 · Auditor: design+eng audit pass ("designer's eye")
> Scope: **entire app** — visual system, interaction feedback, layout/IA, microinteractions, onboarding, timeline.
> Method: live drive of the running app via CDP (headless Chrome, real mouse/keyboard events) at 1440×900, 1920×1080, 1280×800, 390×844; fresh-localStorage first-run runs; computed-style + WCAG contrast measurements; source cross-reference. All 40 screenshots in `/tmp/uiux-shots/`.
> Relationship to prior docs: `INSPECTOR-UX-PLAN.md` findings are **not re-litigated**; where I re-tested them I mark ✅ fixed / ⚠️ still open. This doc covers new ground.

Severity: 🔴 breaks trust · 🟡 noticeably unpolished · 🟢 nit. Effort: **S** ≤1 day · **M** 2–3 days · **L** ≥1 week.

---

## 1. Executive summary

Keyforge's bones are genuinely good: a real token system with a 4px space scale and motion tokens, a coherent DevTools-style inspector, working focus-visible coverage, honest inline validation, and a first-run empty state with strong copy. The 2026-08-23 inspector fixes hold up under live testing (stable rows, preset clicks, clamped times, per-property unit filtering).

The polish gaps are now **systemic, not structural**:

1. **The design system is leaking.** Undefined tokens in shipped CSS (`--text-xs`), a hardcoded One-Dark hex palette inside the inspector, dead header styles from an older layout, and radius fallback literals — small drifts that compound.
2. **The timeline — the product's centerpiece — has the least interaction design.** No hover states, no cursor changes, a hairline playhead with a 12px hit zone, a native `prompt()` dialog for duration, and no cross-highlighting between canvas and inspector.
3. **The app's own chrome has zero motion personality.** An animation tool whose panels, popovers, and diamonds appear/disappear abruptly. The motion tokens (`--ease-spring`, `--duration-base`) are defined and barely used.
4. **Onboarding's best moment never fires** — first run is silently seeded with a pre-made doc, so the guided empty state is unreachable for new users; and the sample's Dot layer rotates a radially-symmetric circle, i.e. its headline transform track is invisible.

None of these are hard. Most quick wins are ≤1 day each; the two M-effort investments worth making are a **playhead/timeline affordance pass** and a **motion-personality pass**.

---

## 2. What already shines (keep, protect)

- **Focus-visible is real**: global `:focus-visible` outline (2px accent) verified on chips, tabs, layer rows, track buttons (shots 10–12). Tab order is logical: doc bar → layer ops → tabs → track ops → rows.
- **Chip hover/active language**: border-tint on hover, accent-tinted editing state, error state — reads like DevTools (shot 14).
- **Scrub + nudge**: drag-scrub on number chips works and commits cleanly (0 → 0.32); ↑↓ nudges with registry clamping; Shift = ×10 (verified live).
- **Inline duration editor** in the playback cluster (dashed underline affordance → input) is a genuinely nice pattern.
- **CSS tab**: Shiki highlighting, working copy button with `✓ Copied` feedback, per-layer/full-doc scope toggle.
- **Empty-state card**: clear value-prop copy, two distinct CTAs, diamond motif ties to the product's core metaphor.
- **Prior audit fixes verified live**: preset click keeps editor open; bezier handle drag survives commits; time entry `99999` clamps to duration (was F6); unit dropdowns are registry-filtered (was F5); track removal works.

---

## 3. Findings

### A. Visual design-system coherence

**F1 🟡 Undefined token `--text-xs` used in shipped styles.**
`src/styles/components/_header.css` sets `font-size: var(--text-xs)` (×2) but only `--font-size-xs` exists. The header duration label/unit silently inherit the 15px body size instead of the 11px caption step, breaking the type hierarchy in exactly the place where a time readout should be quiet. This is the same bug class as SESSION #26 (`--color-text-faint` consumed-but-undeclared) — it will keep recurring without a guard.
_Evidence:_ source grep; shot `40-playback-crop.png` (duration text visibly larger than the adjacent mono time counter).
_Recommendation:_ fix the two refs to `--font-size-xs`; add a stylelint rule (or a vitest over the CSS bundle) asserting every `var(--…)` resolves to a declared token.
_Effort:_ **S**

**F2 🟡 Inspector chip palette lives outside the token system.**
`.inspector` hardcodes `--chip-num:#61afef`, `--chip-color:#d19a66`, `--chip-easing:#c678dd`, `--chip-fn:#e5c07b` — a One-Dark hex palette in an otherwise HSL-token app. Consequences: invisible to token tooling, untunable for contrast, and a second color language that can drift from the accent system.
_Evidence:_ `inspector.css:15-19`.
_Recommendation:_ promote the four chip colors to `:root` tokens (documented as "code/syntax palette" alongside accent), reference them from `.inspector`.
_Effort:_ **S**

**F3 🟡 `--color-text-faint` fails WCAG for the text it's used on (2.80:1).**
`hsl(220 8% 40%)` on `--color-surface` measures **2.80:1** (needs 4.5:1). It's used for real text: keyframe-time unit suffixes, track keyframe-count pills, collapse chevrons, the "No keyframes — tap + KF" hint, spring output readout. Muted (52%) measures 4.31–4.75 — faint is the outlier.
_Evidence:_ computed contrast run; shots `15`, `27` (empty-track hint barely legible).
_Recommendation:_ raise faint to `hsl(220 8% 48%)` (≈4.5:1) or reserve it for decorative marks and switch those labels to `muted`.
_Effort:_ **S**

**F4 🟢 White-on-accent primary button is 3.56:1.**
`.btn--primary` text `hsl(0 0% 100%)` on `hsl(264 80% 68%)` = 3.56:1 — passes only as "large text"; the button is 13px/500. The empty-state CTA is the app's most important button.
_Evidence:_ contrast run.
_Recommendation:_ darken label to `hsl(262 30% 12%)` (≈7:1) or deepen accent to `hsl(264 65% 60%)`. One-line change.
_Effort:_ **S**

**F5 🟢 Radius/family drift in ad-hoc styles.**
Base defines `--radius-sm:3px / md:6 / lg:10`, but DocBar uses `var(--radius-sm, 4px)`, css-import `var(--radius-lg, 10px)`, and inspector.css has ~10 raw `3px/4px` literals. Fallbacks currently match token values, so nothing visibly breaks — but the pattern invites divergence, and `--mono` is re-declared per-component instead of living in tokens.
_Evidence:_ grep across styles.
_Recommendation:_ one sweep replacing fallback-literal patterns and raw radii with tokens; hoist `--mono` to `:root`.
_Effort:_ **S**

**F6 🟢 Two header systems coexist; one is dead.**
`base.css` still ships `.app` grid layout + `.app__header`, and `_header.css` styles a `.header__duration` control — none rendered (App uses `.app__doc-header` + `.playback`). The dead `_header.css` duration-input styles aren't even the live duration control (that's `.playback__duration-input`). Dead CSS misleads future edits.
_Recommendation:_ delete `.app__header`/`.header__*` blocks and the base.css grid `.app` (superseded by `display:contents` in app.css).
_Effort:_ **S**

### B. Interaction feedback

**F7 🟡 Loop toggle's active state is nearly invisible.**
`.btn--active` only recolors the ⟲ glyph to accent — no background, no fill change, no `aria-pressed`. At a glance loop-on and loop-off are indistinguishable (verified in shot `40-playback-crop.png`). State visibility for toggles is table stakes.
_Recommendation:_ `aria-pressed={loop()}` + active style = `background: color-mix(accent 14%, transparent); color: accent;` (same recipe the easing presets already use — reuse it for consistency).
_Effort:_ **S**

**F8 🟡 Play button has no accessible name.**
Stop has `title="Stop"`, Loop has `title="Loop"`, **Play/Pause has neither title nor aria-label** — the primary control of the app announces nothing to AT and shows no tooltip.
_Evidence:_ DOM dump of `.playback .btn`s.
_Recommendation:_ `aria-label` + `title` that flip with state ("Play"/"Pause").
_Effort:_ **S** (trivial)

**F9 🟡 Native `prompt()` dialog for duration on the timeline.**
Double-clicking the timeline's duration handle opens `window.prompt('Set duration (ms)')` (`Timeline.tsx:195`) — a browser-chrome dialog that breaks the app's visual language, can't be styled, and is blocked by some browsers in embedded contexts. Meanwhile the playback cluster already has a beautiful inline click-to-edit duration. Two patterns for the same property; the worse one is on the timeline.
_Recommendation:_ reuse the Playback inline editor pattern (or a small popover anchored to the handle); add a tooltip on the handle ("Drag to resize · double-click to type").
_Effort:_ **S**–**M**

**F10 🟡 Timeline canvas has zero hover feedback.**
Cursor is `crosshair` everywhere: over keyframe diamonds (should be `grab`), over the ruler (should be `ew-resize`/`text`), over the duration handle (only becomes `ew-resize` _after_ the first mousemove — initial hover shows crosshair). Diamonds don't respond to hover at all; no ghost time label follows the cursor while scrubbing. Compared to DevTools' ruler or any NLE, the timeline feels inert until you commit to a click.
_Evidence:_ live cursor probes; shots `19`, `34`.
_Recommendation:_ (a) hit-test on mousemove → swap cursor for diamond/handle/ruler zones; (b) redraw hovered diamond at 1.3×; (c) ghost time chip (`1.24s`) following the cursor over the ruler during scrub. (a)+(b) are cheap; (c) is the delight win.
_Effort:_ **M**

**F11 🟢 Selected keyframe doesn't cross-highlight in the inspector.**
Clicking a diamond selects it (canvas fills it white) but the inspector row shows no selection state and doesn't scroll into view; conversely there's no way to see _which_ row owns the white diamond without hunting. AE/Rive/DevTools all cross-highlight.
_Evidence:_ shot `21-kf-selected-timeline.png` + DOM probe (no selected-row attribute).
_Recommendation:_ `.kf-row--selected` (left 2px accent inset + faint accent bg), scrollIntoView({block:'nearest'}) on canvas-select.
_Effort:_ **M**

**F12 🟡 CSS-import modal: no autofocus, no Escape, no focus trap, no `aria-modal`.**
Opening "From CSS…" leaves focus on the trigger button; **Escape does nothing** (verified live) even though the app just shipped a "uniform Escape contract" (#48) for the easing editor; `role="dialog"` without `aria-modal="true"`; backdrop click closes but keyboard users must tab through the whole page. The modal is also the only dark-overlay surface whose scrim uses a different color math (`oklch from --color-bg`) than the empty state (`color-mix`) — pick one.
_Evidence:_ live probes; shot `24-css-import-modal.png`.
_Recommendation:_ autofocus the textarea; Escape closes (restoring focus to trigger); `aria-modal="true"`; ~10-line focus trap; unify scrim formula.
_Effort:_ **S**

**F13 🟡 Import/validation errors are easy to miss.**
Invalid CSS shows a red warning _below_ a 220px textarea (often below the fold) while the Import button stays enabled (verified: warning "No @keyframes rules found…" + enabled button, shot `25`). JSON import errors render at the far right of the doc bar where they can clip. Duration's invalid state turns the text red but never says why (max 60s) and has no `aria-live`.
_Recommendation:_ disable Import while parse fails; move the warning adjacent to the action row; add `aria-live="polite"`; duration gets a one-line helper ("0.1–60s").
_Effort:_ **S**

### C. Layout & information architecture

**F14 🟡 Panel proportions don't re-clamp across viewport sizes.**
Split.js `maxSize: [320, ∞, 400]` is enforced at drag-time only. Measured: at 1920 the inspector is **497px** wide (beyond its own 400 max) while the preview balloons to 1071; at 1280 inspector 331 / preview 713. The inspector's content is a fixed ~260–320px column, so extra width becomes dead space while the preview — the thing that benefits from width — is fine but unbalanced against the 1280 case where the inspector crowds the chips.
_Evidence:_ measured rects at 3 sizes; shots `05`, `08`, `09`.
_Recommendation:_ on window resize, re-clamp sizes to min/max (Split.js `setSizes` with computed px→%); or persist user sizes and clamp on load.
_Effort:_ **M**

**F15 🟡 DocBar IA: five flat, vague, ungrouped text buttons.**
`Export · CSS · CSS·RM · Import · From CSS…` mixes import and export with no visual grouping; "Export" (JSON) vs "CSS" (download) is a guessable-but-confusing pair; "CSS·RM" is cryptic (its long title is hover-only). All five are identical ghost buttons, so frequency and direction (in vs out) don't read.
_Evidence:_ shot `35-docbar-crop-2x.png`.
_Recommendation:_ two grouped clusters with a hairline divider: **Import** (file / paste-CSS as a small menu or two labeled buttons) | **Export ▾** (JSON / CSS / CSS·RM). Keep ghost styling; add icons (↓/↑) to encode direction.
_Effort:_ **M**

**F16 🟢 Preview stage is a hardcoded 600×400.**
`.preview__canvas` doesn't scale to its panel; at narrow splits (or 1280×800 after dragging gutters) the stage clips with `overflow:hidden` and content is lost rather than scaled.
_Recommendation:_ scale-to-fit wrapper (`transform: scale(min(1, panelW/620, panelH/420))` or container-query units).
_Effort:_ **M**

**F17 🟢 Timeline label column is a fixed 120px with no text clipping.**
Canvas draws `layer.name / property` at x=8 with `measureText` never checked; "Background layer / background-color" will run under the lane and collide with the first diamond. Layer names _are_ ellipsized in the tree — the canvas should match.
_Recommendation:_ clip + ellipsize via `ctx.measureText` against `LABEL_WIDTH - 16`.
_Effort:_ **S**

### D. Microinteractions & delight

**F18 🟡 The app's own chrome has no motion personality.**
An animation tool where: the easing editor pops in/out with no transition, the CSS modal appears instantly, keyframe diamonds materialize/vanish without a beat, the empty-state card (with three diamonds begging for a staggered float) is static, and panel resizes snap. The token layer even defines `--ease-spring`, `--ease-out-expo`, `--duration-base` — almost unused (only gutters/chips at 120ms). Best-in-class tools (Linear, Figma) make chrome motion _felt but unfelt_: 150–220ms, 2–4px travel, spring on state changes.
_Recommendation:_ a focused pass — (1) easing editor + modal: 160ms fade + 4px rise with `--ease-out-expo`; (2) diamond add/remove: scale pop 1→1.15→1 (canvas: animate radius over 150ms); (3) empty-state diamonds: 3s staggered float loop (reduced-motion guarded); (4) respect `prefers-reduced-motion` globally (today only the spring demo dot is guarded — verified).
_Effort:_ **M**

**F19 🟢 Empty timeline gives no guidance.**
With zero layers, the timeline is a blank dark rectangle (shot `33`) while the preview shows the empty-state card. The timeline should echo the moment: "No tracks yet — add a layer to start" drawn on canvas or as an overlay.
_Effort:_ **S**

**F20 🟡 Sample animation's headline transform track is invisible.**
The Dot layer animates `rotate(0→180→360deg)` on a **radially symmetric circle** — rotation produces zero visible change (verified frames `06`/`07`: dot never moves or visibly spins; only the hue cycle reads). First-run users watch a track that appears to do nothing — the worst possible demo of a _visual_ keyframe editor.
_Recommendation:_ change the Dot's transform track to `translateX(-60px) → translateX(60px)` (or scale 1→1.3), or make it a rounded square so rotation reads. Also consider a third beat (e.g., Box scale bounce) so the sample shows 3 distinct technique flavors.
_Effort:_ **S**

### E. Onboarding & first run

**F21 🟡 The guided empty state is unreachable on true first run.**
The store seeds `defaultDoc` (a full Box layer with tracks) whenever no autosave exists — so a brand-new user never sees the carefully-written EmptyState card; it only appears _after_ they delete everything. The onboarding moment ships disabled.
_Evidence:_ fresh-localStorage runs — shot `01` (claimed first run) actually shows the pre-seeded doc; `03` same; empty state only after layer removal (`33`).
_Recommendation:_ seed a **0-layer document** on true first run (keep `defaultDoc` as what "Add your first layer" creates — it's a great _result_, just not a great _opening state_). Persist a `keyforge:onboarded` flag so returning users with an empty doc (who deleted things deliberately) aren't re-nagged — or accept the card as the natural empty state.
_Effort:_ **S**

**F22 🟢 No shortcut discoverability; Space doesn't play/pause.**
Space with body focus does nothing (verified). No global keys at all: no Space (play/pause), no ⌘Z (no undo system yet — known), no Delete on selected keyframe, no `[`/`]` stop-jumping (spec'd in DEVTOOLS-TOKEN-UI, still open). The good per-control `title`s (e.g. "Drag to scrub · ↑↓ nudge · tap to edit") are discoverable only one-hover-at-a-time. A "?"-overlay or a one-time hint chip would compound them.
_Recommendation:_ Space = play/pause (guard: not in inputs) is the single highest-value key; add a minimal shortcuts popover later.
_Effort:_ **S** for Space / **M** for the overlay.

### F. Timeline-specific (consolidated)

**F23 🟡 Ruler is minimal: 10 ticks, no minors, edge labels cramped, no scrub time.**
Ticks at every 10% with `x+4` label offset; "0.0s" starts right at the lane boundary and the final label nearly collides with the duration handle at 1280px (shot `34`). No 0.5s minor ticks, no hover/scrub time readout (the playback counter is 800px away — eyes must travel).
_Recommendation:_ minor ticks at 1/50 with 4px height; ghost time chip near the cursor while scrubbing (pairs with F10c).
_Effort:_ **M** (with F10)

**F24 🟡 Playhead is a 2px hairline with a 6px triangle and no grab affordance.**
No head to grab (you must aim at the ruler), no time badge, no emphasis while dragging, no shadow above lanes. In every reference tool the playhead is the most-grabbed object on screen.
_Recommendation:_ 10–12px hit zone across full height; rounded head cap; time bubble while dragging; slight accent glow while scrubbing.
_Effort:_ **M**

**F25 🟢 Diamonds: no outline, no hover, selection = white fill only.**
6px rotated squares; on the amber track (track-4) contrast is fine, but selected state is just a white fill — no ring, no scale — and hover does nothing (canvas is static between events). Adjacent diamonds at the same time on different tracks are the normal case and read fine; the issue is state feedback, not visibility.
_Recommendation:_ 1px `--color-bg` outline (crisp on all 4 track colors); hover = 1.3× (with F10b); selected = white fill + accent ring.
_Effort:_ **S**–**M**

---

## 4. Carried-over inspector findings — re-tested 2026-08-24

| Old finding                     | Status today                                                                                                                                                     | Evidence                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| F1 rows rebuild on commit       | ✅ fixed — editor survives handle drags + preset clicks                                                                                                          | shots `31`, `32`; live probes |
| F2 named easing = straight line | ✅ fixed — ease-out resolves; preset highlights active                                                                                                           | shot `17`                     |
| F3 empty value commits          | ✅ blocked on live paths (number field cancels NaN; colors CSS.supports). _Note:_ `validate()` still contains a dead `value === ''` branch — remove for hygiene. | source `Inspector.tsx:79`     |
| F5 nonsense units               | ✅ fixed — unit dropdown registry-filtered                                                                                                                       | code + live                   |
| F6 time > duration accepted     | ✅ fixed — clamps to 2000ms                                                                                                                                      | live test                     |
| F8 RotationDial never appears   | ⚠️ **still open** — added `rotate` track, no dial anywhere (transform chip has no angle affordance)                                                              | shot `18`                     |
| F9 duplicate property tracks    | ⚠️ **still open** — added a 2nd `opacity` track silently                                                                                                         | shot `16`                     |
| F10 Escape closes easing editor | ⚠️ **partial** — works from canvas focus; does **not** close from chip/body focus                                                                                | live probes                   |
| F11 color editing split-brain   | ⚠️ **still open** — swatch (crosshair cursor, no tooltip) → native hex picker; label → text input; EyeDropper available & unused                                 | shot `28`                     |
| F17 no undo                     | ⚠️ still open — Ctrl+Z after layer deletion does nothing, no toast                                                                                               | live probe                    |

---

## 5. Prioritized summary

| #             | Finding                                                  | Sev | Effort             |
| ------------- | -------------------------------------------------------- | --- | ------------------ |
| F10           | Timeline hover/cursor/ghost-time feedback                | 🟡  | M                  |
| F24           | Playhead affordance upgrade                              | 🟡  | M                  |
| F18           | Motion-personality pass on chrome                        | 🟡  | M                  |
| F21           | First-run seeds doc → empty state never fires            | 🟡  | S                  |
| F20           | Sample Dot rotation invisible                            | 🟡  | S                  |
| F14           | Panel sizes don't re-clamp on resize                     | 🟡  | M                  |
| F15           | DocBar import/export grouping & labels                   | 🟡  | M                  |
| F9            | Native `prompt()` for duration on timeline               | 🟡  | S/M                |
| F1            | `--text-xs` undefined in header styles                   | 🟡  | S                  |
| F3            | `--color-text-faint` fails WCAG (2.80:1)                 | 🟡  | S                  |
| F7            | Loop active state invisible + no aria-pressed            | 🟡  | S                  |
| F12           | Modal: no autofocus/Escape/trap                          | 🟡  | S                  |
| F13           | Import errors easy to miss; duration invalid unexplained | 🟡  | S                  |
| F2            | Inspector hex palette outside tokens                     | 🟡  | S                  |
| F23           | Ruler minor ticks + cramped edge labels                  | 🟡  | M                  |
| F11           | No timeline↔inspector cross-highlight                    | 🟢  | M                  |
| F19           | Empty-timeline guidance                                  | 🟢  | S                  |
| F22           | Space doesn't play/pause; no shortcut layer              | 🟢  | S/M                |
| F25           | Diamond outline/hover/selection ring                     | 🟢  | S/M                |
| F4            | Primary button contrast 3.56:1                           | 🟢  | S                  |
| F5            | Radius/fallback drift                                    | 🟢  | S                  |
| F6            | Dead header CSS                                          | 🟢  | S                  |
| F16           | Preview stage fixed 600×400                              | 🟢  | M                  |
| F17           | Timeline label column overflow                           | 🟢  | S                  |
| F8/F9/F11-old | RotationDial / dup tracks / color picker (carried)       | 🟡  | see INSPECTOR plan |

---

## 6. Quick wins — one focused session (all S, high polish-per-line)

1. **Fix `--text-xs` refs** in `_header.css` → `--font-size-xs` (F1).
2. **Play button** `aria-label`/`title` flipping with state (F8).
3. **Loop button**: `aria-pressed` + accent-tint bg when active, reusing the easing-preset active recipe (F7).
4. **Raise `--color-text-faint`** to `hsl(220 8% 48%)` (F3).
5. **Primary button label** → near-black ink (F4).
6. **Modal hygiene**: autofocus textarea, Escape closes + restores focus, `aria-modal="true"` (F12).
7. **Import button disabled** while textarea fails parse; duration helper text "0.1–60s" (F13).
8. **Sample fix**: Dot transform → `translateX` so the demo actually demos (F20).
9. **True first run**: seed 0-layer doc so the EmptyState card fires (F21).
10. **Empty-timeline hint** drawn on canvas when `doc.layers.length === 0` (F19).
11. **Space = play/pause** (guard against inputs) (F22).
12. **Delete dead `.app__header`/`.header__*` CSS** (F6).
13. **Promote chip hexes to root tokens** (F2).
14. **Diamond 1px outline** for track-color-agnostic contrast (F25, partial).

---

## 7. Bigger bets (queue after quick wins)

- **Timeline interaction pass** (F10 + F23 + F24 + F25 + F11): hover cursors, ghost scrub time, chunky playhead, diamond states, cross-highlighting. One coherent PR, ~1 week. This is the single biggest "feels like a real tool" lever remaining.
- **Motion pass** (F18): entrance/exit transitions on editors/modals, diamond pop, empty-state idle animation — all reduced-motion-guarded.
- **DocBar regrouping** (F15) once export formats grow (WAAPI export is on the Phase 3 roadmap — design the menu now).

---

## Appendix — Screenshot inventory (`/tmp/uiux-shots/`)

| File                      | What it shows                                                           |
| ------------------------- | ----------------------------------------------------------------------- |
| 01-first-run-empty-1440   | "First run" — actually pre-seeded default doc (F21 evidence)            |
| 03-fresh-load-default-doc | Fresh load after storage clear — same seeded doc                        |
| 02 / 33                   | Empty state card (after manual layer removal)                           |
| 05 / 08 / 09              | Layout at 1440 / 1920 / 1280 (F14 evidence)                             |
| 06 / 07                   | Sample playing mid/late — Dot rotation invisible (F20)                  |
| 10–12                     | Focus-visible sweep via Tab                                             |
| 13 / 14 / 38              | Hover states: layer row, kf row, +KF button                             |
| 15 / 16                   | Inspector default; duplicate opacity track allowed (old F9)             |
| 17 / 31 / 32              | Easing editor open; sections/presets; handle drag survives              |
| 18                        | Rotate track with no dial (old F8)                                      |
| 19 / 20 / 21 / 34         | Timeline default, after kf drag, kf selected, 2× crop (F10/F23/F24/F25) |
| 22 / 23 / 41              | CSS tab; copy feedback; toolbar 3× crop                                 |
| 24 / 25                   | CSS import modal; invalid-CSS warning + enabled button (F12/F13)        |
| 26                        | Duration invalid red state, no message (F13)                            |
| 27                        | Empty-track hint in faint text (F3)                                     |
| 28                        | Color chip text-edit path (old F11)                                     |
| 29 / 30                   | Transform stack picker; rotate added                                    |
| 35 / 40                   | DocBar 2× crop; playback cluster 2× crop (F15/F7)                       |
| 36 / 37                   | Mobile 390×844: layers / preview / inspector tabs                       |

_Report ends. Worktree left uncommitted per instructions._
