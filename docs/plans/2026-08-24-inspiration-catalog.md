# Inspiration Catalog — DevTools, After Effects & Motion-Design Tools

> Research only. No code changes accompany this document.
>
> Goal: concrete feature / UX / UI ideas for Keyforge (visual keyframe editor for CSS/WAAPI), harvested from Chrome DevTools' Animations panel + Easing Editor, Firefox DevTools' Animation inspector, After Effects, Rive, Figma, LottieFiles and Cavalry. Each idea is rated for relevance to Keyforge's stack (CSS/WAAPI export, no-runtime-lock-in principle) and given a rough implementation surface.
>
> Keyforge state this catalog assumes (read from `src/` at 91b33de): SolidJS store (`doc → layers → tracks → keyframes{time,value,easing}`), Canvas-2D timeline with ruler/playhead/diamonds/snap-increment/duration-handle, WAAPI negative-delay scrubbing preview, DevTools-style token Inspector (`tokenize.ts`), EasingEditor (cubic-bezier canvas handles + presets + persisted custom library + raw input), spring generator emitting `linear()` easings (`utils/spring.ts`), per-track `@keyframes` CSS export + reduced-motion variant, CSS import with lossless round-trip, live-editable CSS panel (#70).

Sources consulted:

| Source | Links |
| --- | --- |
| Chrome DevTools Animations panel (official docs) | developer.chrome.com/docs/devtools/css/animations |
| Chrome DevTools Easing Editor / linear() | developer.chrome.com/docs/devtools/css/reference · developer.chrome.com/docs/css-ui/css-linear-easing-function · blog "What's New in DevTools 116" |
| devtools-frontend source | `front_end/panels/animation/AnimationTimeline.ts`, `AnimationUI.ts` (GlobalPlaybackRates = `[1, 0.25, 0.1]`; drag events `KeyframeMove` / `StartEndpointMove` / `FinishEndpointMove`; delay/end-delay hatch lines; iteration rendering; BezierUI velocity chart; step-line rendering) |
| Firefox DevTools animation inspector | firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations (+ FF41–42 page; bugzilla 1211801 playback-rate selector) |
| After Effects Graph Editor / keyframe assistants | helpx.adobe.com "Apply and control speed changes"; School of Motion & Mt. Mograph graph-editor guides (value vs speed graph, Easy Ease F9, influence %) |
| Rive editor docs | rive.app/docs/editor/animate-mode/{timeline, interpolation-easing} |
| Figma | help.figma.com easing & spring articles; figma.com/blog/how-we-built-spring-animations |
| LottieFiles Creator docs | docs.lottiefiles.com/en/creator (timeline, keyframes pages) |
| Cavalry docs | cavalry.studio/docs (Timeline, Time Editor, Graph Editor) |

---

## Executive shortlist — top 10 by value-to-effort

| # | Idea | Theme | Relevance | Surface |
|---|------|-------|-----------|---------|
| 1 | Slow-motion playback-rate presets (25% / 10%) | Playback | High | S — store+Playback |
| 2 | Jump to prev/next keyframe shortcuts | Playback | High | S — store+Timeline |
| 3 | Work area / loop-range bookends on the ruler | Playback | High | M — Timeline+store |
| 4 | Batch easing assistant ("easy ease" selected segments) | Easing | High | S — store+EasingEditor |
| 5 | Ball-drop motion preview in the EasingEditor | Easing | High | S — EasingEditor |
| 6 | Drag-the-gap "keybars" between adjacent diamonds | Timeline editing | High | S–M — Timeline |
| 7 | Easing glyph drawn in each segment between diamonds | Easing/Timeline | High | M — Timeline canvas |
| 8 | `linear()` stop-graph editor mode (for springs) | Easing | Med-High | M — EasingEditor |
| 9 | Marquee multi-select + align + scale-selection retime | Timeline editing | Med-High | M — Timeline+store |
| 10 | Compositor-friendliness badge in Inspector/export | Inspection/Export | High | S — Inspector+export |

Runners-up worth queueing: magnet-snap drags to other keyframes, cursor-centered zoom, hover-row→preview highlight, diamond easing-class icons, timeline markers/beats, keyframe optimizer.

---

## 1. Playback & scrubbing

### 1.1 Slow-motion playback-rate presets
- **Interaction:** A small segmented control next to transport: **100% / 25% / 10%**. Selecting a rate multiplies effective playback speed so fast animations become inspectable mid-flight; scrub gestures remain real-time (rate affects play only). Chrome ships exactly `[1, 0.25, 0.1]` as global rates plus a Pause entry in that listbox; Firefox added a rate dropdown for the same reason ("making animations run slower is useful to fine tune them" — bugzilla 1211801).
- **Source:** Chrome Animations panel Controls bar; Firefox inspector toolbar.
- **Relevance:** **High** — pure preview-side concern, zero export impact (never emit `playbackRate`). Perfectly aligned with WAAPI scrubbing: set `player.playbackRate`.
- **Surface:** **S** — store signal `playbackRate`, consumed by Preview's rAF/WAAPI driver; buttons in `Playback.tsx`.

### 1.2 Replay button (restart-and-play)
- **Interaction:** One click restarts the current selection/document from 0 and plays — distinct from Stop (which parks at 0). Chrome's toolbar pairs replay with the rate buttons; hovering an overview thumbnail also replays.
- **Source:** Chrome Animations panel.
- **Relevance:** **High** — trivial affordance, constant use while tuning timing.
- **Surface:** **S** — `Playback.tsx` (existing toggle already rewinds-at-end).

### 1.3 Work area / loop range bookends
- **Interaction:** Two draggable bookends on the ruler define the playback window; loop iterates within it; dragging the bar between them slides the whole window. Cavalry binds `B`/`N` to set start/end; Rive calls it Work Area; LottieFiles has trim controls.
- **Source:** Cavalry Timeline (bookends, B/N), Rive (Work Area), LottieFiles (work-area trim).
- **Relevance:** **High** — editor-only concern; nothing exported (CSS always covers full duration), so no lock-in risk. Huge when iterating on one beat of a 5s sequence.
- **Surface:** **M** — store `{in,out}`, ruler hit-zones + new drag modes in Timeline's pointer FSM, clamp logic in Preview's loop.

### 1.4 Ping-Pong playback → `animation-direction: alternate`
- **Interaction:** Third loop mode alongside Loop/One-Shot where playback reverses at the end. Unlike the work area, this one *is* exportable: CSS `animation-direction: alternate` / `alternate-reverse` expresses exactly this.
- **Source:** Rive playback modes (One-Shot / Loop / Ping-Pong).
- **Relevance:** **High** — rare case where a motion-tool concept maps 1:1 onto existing CSS output tokens. Also unlocks `animation-direction: reverse` as a cheap "reverse animation" command (AE's time-reverse keyframes assistant equivalent, without rewriting keys).
- **Surface:** **S–M** — doc-level field + Playback UI + export option in `export.ts`; preview honors it natively via CSS/WAAPI direction.

### 1.5 Jump to previous / next keyframe
- **Interaction:** Shortcuts move the playhead to the nearest keyframe left/right across *all* tracks (optionally filtered to the selected layer). LottieFiles uses `J`/`L`; Cavalry uses Alt/Cmd+←/→ with selection-filtering.
- **Source:** LottieFiles timeline; Cavalry shortcuts.
- **Relevance:** **High** — complements existing snap increment; makes value-entry workflows (add KF at playhead) fast without mouse hunting.
- **Surface:** **S** — store util scanning track keyframe times; bind in `playbackShortcuts.ts`.

### 1.6 Shift-drag scrub snaps to visible keyframes
- **Interaction:** Modifier-dragging the playhead magnets it to any visible keyframe time (not just fixed increments). LottieFiles: Shift+drag playhead snaps to visible keys.
- **Source:** LottieFiles; Cavalry (Shift+drag snaps to 10th frames/markers).
- **Relevance:** **High** — Keyforge has numeric snap increments but no structural snapping; key-to-key alignment is the most common intent.
- **Surface:** **S** — in `snappedXToTime()`, if modifier held, snap to sorted union of keyframe times within a few px.

### 1.7 Zoom around the cursor / playhead
- **Interaction:** Ctrl/Cmd+wheel or pinch zooms the timescale keeping the point under the cursor anchored; zoom slider + pan bar above the ruler like Lottie/Rive. Today Keyforge maps horizontal wheel to scrub only.
- **Source:** LottieFiles (zoom centered on playhead/cursor, slider, pinch); Rive (scrollbar-with-grabbers); Cavalry.
- **Relevance:** **High** once documents exceed viewport width (multi-layer sequencing is planned Phase 4). Requires decoupling px↔ms mapping from "fit whole duration".
- **Surface:** **M** — view-state `{pxPerMs, scrollX}` in store/prefs, rewrite of `timeToX/xToTime`, wheel handling; gesture code otherwise unchanged.

### 1.8 Auto-grow the timeline window
- **Interaction:** When content approaches the right edge (~80% width), grow the visible duration automatically instead of forcing manual handle drags. devtools-frontend checks `delayOrStartTime() + duration() > timeline.duration() * 0.8` and extends.
- **Source:** Chrome AnimationTimeline source.
- **Relevance:** **Med** — nice polish on top of the duration handle; matters more once layers carry offsets.
- **Surface:** **S** — check in `addKeyframe`/drag handlers; bump `setDuration` to next nice step.

### 1.9 Capture-and-pause moment (future-proofing)
- **Interaction:** Chrome pauses newly captured animations immediately so pseudo-element trees (::view-transition) can be inspected mid-flight, then resume/replay.
- **Source:** Chrome docs (View Transitions section).
- **Relevance:** **Low now / Med later** — becomes relevant with the planned View Transitions mode (Phase 4): offer "pause at t" inspection of generated pseudo-elements.
- **Surface:** **L** (deferred) — depends on VT mode.

---

## 2. Timeline editing

### 2.1 Drag-the-gap "keybars"
- **Interaction:** The segment *between* two diamonds is itself a grabbable object: dragging it moves both keyframes together preserving spacing; Cavalry draws it solid when values differ, dashed when static (instant read of "dead zones").
- **Source:** Cavalry Time Editor (keybars).
- **Relevance:** **High** — today nudging a pair requires two precise diamond grabs. Segment-hit-test slots into the existing pointer FSM naturally.
- **Surface:** **S–M** — Timeline hit-testing gains a segment zone; store mutation shifting two kf times; dashed-vs-solid draw rule.

### 2.2 Marquee select, shift-click, select-all-keys-of-layer
- **Interaction:** Rubber-band selection over rows; Shift+click adds; selecting a layer row selects all its keys (Cmd+A). Selection is cross-track. LottieFiles documents all three; Cavalry adds marquee + transform tooling.
- **Source:** LottieFiles keyframes docs; Cavalry Time Editor.
- **Relevance:** **High** — prerequisite for ideas 2.3/2.4/4.x and batch easing (§3.2). Store currently holds single `selectedKeyframeId`; needs a set.
- **Surface:** **M** — store `selectedKfIds: Set`, Timeline marquee overlay drawing + hit logic, Inspector shows N-selected summary.

### 2.3 Align selected keyframes
- **Interaction:** Align-left/right/center operations on the selected keyframe group (each contiguous cluster treated like a bounding rect). Cavalry aligns "groups" of keys like shapes.
- **Source:** Cavalry Time Editor align tool.
- **Relevance:** **Med-High** — cheap once multi-select exists; fixes the classic "these two beats should start together" chore.
- **Surface:** **S** — store mutation over selection; context-menu/buttons in Timeline or Inspector.

### 2.4 Scale-selection retiming (transform-tool)
- **Interaction:** With multiple keys selected, drag either end of the green selection frame to stretch/compress their times proportionally (retime a beat without touching values). Cavalry's Transform tool; LottieFiles "retiming".
- **Source:** Cavalry; LottieFiles.
- **Relevance:** **Med-High** — big win for fitting motion into a changed duration; pure editor math, exports stay vanilla.
- **Surface:** **M** — needs §2.2 first; scale math + min-gap guardrails in store.

### 2.5 Copy/paste keyframes (paste-at-playhead)
- **Interaction:** Cmd/Ctrl+C copies selected keyframes (value+easing+relative times); paste inserts at playhead, optionally onto a different layer/track of the same property. LottieFiles supports cross-layer paste; AE's copy/paste is the ancestor.
- **Source:** LottieFiles; After Effects.
- **Relevance:** **High** — pairs with the persisted easing library: reuse whole mini-motions, not just curves. Export unaffected.
- **Surface:** **M** — clipboard model `{property, keyframes[]}`, paste mapping rules (same property required? retarget?), menu + shortcuts.

### 2.6 Magnet snapping targets with threshold
- **Interaction:** During any drag, nearby keyframes/clip-edges/markers act as snap targets within an N-pixel threshold; toggleable per target type. Cavalry exposes threshold + per-target switches.
- **Source:** Cavalry snapping settings.
- **Relevance:** **Med** — generalizes §1.6 to all gestures; keeps the existing snap-increment system as fallback.
- **Surface:** **S–M** — extend `snap.ts` with candidate-provider + px threshold; prefs toggles.

### 2.7 Timeline markers & pacing (beat) guides
- **Interaction:** Right-click ruler to drop named markers; optional second-scale pacing guides (e.g., every 500ms "beats") shown as subtle verticals; keys/marker edges snap to them.
- **Source:** Cavalry (Time Markers, pacing markers/beats).
- **Relevance:** **Med** — sequencing/stagger work (Phase 4) will want beat references; harmless until then. Markers could export as comments in CSS.
- **Surface:** **M** — doc-level marker list, ruler drawing, snap integration.

### 2.8 Keyframe optimizer (reduce redundant stops)
- **Interaction:** One command scans a track and removes keyframes whose removal keeps interpolated output within tolerance (e.g., collinear middles, duplicate-value holds). LottieFiles ships this to clean baked data.
- **Source:** LottieFiles Keyframe Optimizer.
- **Relevance:** **Med** — directly applicable to CSS *import* round-trips, which often carry redundant stops; shrinks exported CSS.
- **Surface:** **M** — pure function over track + tolerance; needs exact-match validation against `interpolate.ts` before/after; expose per-track in Inspector + pre-export dialog.

### 2.9 Show-only-selected rows filter
- **Interaction:** Toggle collapses the timeline to just the selected layer's tracks. Rive's "Show Only Selected" for dense scenes.
- **Source:** Rive timeline options.
- **Relevance:** **Med** — cheap decluttering lever; interacts with row-height budget in `resize()`.
- **Surface:** **S** — filter predicate in draw/row-count; toggle button near Playback compact strip.

### 2.10 Endpoint/body/keyframe drag grammar (for future offsets)
- **Interaction:** Chrome's per-animation bar grammar: drag body = move start offset (delay), drag end circles = resize duration, white inner circles = retime individual keyframe stops. Delay regions render as hatched lines; fill-mode shading distinguishes backwards-fill delay.
- **Source:** Chrome docs "Modify animations" + AnimationUI source (`StartEndpointMove`/`FinishEndpointMove`, `animation-delay-line`).
- **Relevance:** **Med now / High at Phase 4** — Keyforge has no per-layer start offset yet; when sequencing lands, adopt this exact grammar rather than inventing one. Iteration shading (definition dark, repeats faded) applies if `animation-iteration-count` support is added.
- **Surface:** **L** — new doc fields (delay/iterations), lane rendering changes, drag modes; defer until sequencing epic.

---

## 3. Easing & curves

### 3.1 Easing glyphs drawn between diamonds
- **Interaction:** Each inter-keyframe segment shows a miniature shape encoding its easing: straight fill for `linear`, the cubic-bezier *velocity chart* silhouette for beziers, stair-steps for `steps()` (Chrome draws exactly these three in-lane; Firefox similarly renders the timing-function shape between key stops on the bar). At Keyforge's diamond density, even a simplified glyph (flat line vs S-curve vs bounce-hint) transforms scannability.
- **Source:** Chrome AnimationUI.renderKeyframe (BezierUI.drawVelocityChart, step lines, linear quad path); Firefox inspector bars.
- **Relevance:** **High** — pure visualization of data we already store (`kf.easing`); no export implications.
- **Surface:** **M** — per-segment draw routine in Timeline (reuse/extract `evalCubicBezier` sampling); perf fine at typical counts.

### 3.2 Batch easing assistant ("Easy Ease")
- **Interaction:** With keyframe(s)/segment(s) selected, press a shortcut or click assistant buttons to set easing: Easy-Ease-equivalent (`cubic-bezier(0.42,0,0.58,1)` ≈ AE's 33%-influence), ease-in-only, ease-out-only, linear, hold. AE's trio: F9 = easy ease, Shift+F9 = ease-in, Ctrl/Cmd+Shift+F9 = ease-out.
- **Source:** After Effects Keyframe Assistant; same mental model in Cavalry Magic/interpolation setters and Rive's Interpolation panel icons.
- **Relevance:** **High** — one of the highest-frequency actions in motion tools; today Keyforge easing changes go through the Inspector token-by-token.
- **Surface:** **S** — store mutation over selection; buttons in Playback/EasingEditor strip + `playbackShortcuts.ts`. Note: CSS semantics put easing on the *segment leaving* a keyframe — decide whether "ease-in on last keyframe" writes to the incoming segment.

### 3.3 Numeric handle inputs / influence readout
- **Interaction:** Below the bezier canvas, four number fields (P1x P1y P2x P2y) update live while dragging and accept typing; AE's analog is the Keyframe Velocity dialog where pros type exact Influence percentages for stylistic consistency across a project.
- **Source:** After Effects Keyframe Velocity; Rive Interpolation panel (numeric 4-value representation); Keyforge already has raw-string input — this adds structured fields.
- **Relevance:** **High** — tiny addition; serves the "developer audience shows numbers" principle.
- **Surface:** **S** — EasingEditor footer bound to parse/format helpers already present.

### 3.4 Allow overshoot handles (y outside [0,1])
- **Interaction:** Let control-point handles be dragged beyond the unit box vertically (y<0 or y>1) with visual overflow room, enabling anticipation/overshoot/settle in a single cubic-bezier — the AE value-graph overshoot trick (pull past the target value, return) and Rive's "Cubic Value" selling point, both expressible in CSS because only x is clamped.
- **Source:** After Effects value graph; Rive Cubic Value interpolation; Figma custom-bezier editor explicitly draws space beyond the perimeter for "anticipatory … or overshoot effect".
- **Relevance:** **High** — verify current EasingEditor clamping; if y is clamped to [0,1], relaxing it unlocks a signature capability with zero export cost (spec-valid cubic-bezier).
- **Surface:** **S** — hit-box/clamp constants + extra draw margin in `EasingEditor.tsx`/`dialGeometry.ts`.

### 3.5 Spring editing by direct manipulation
- **Interaction:** Instead of physics sliders, drag a handle *on the rendered spring curve*: horizontal = speed (frequency), vertical = overshoot (damping ratio); separate duration handle marks settle point. Figma's writeup explains why: reduce 3 physics knobs to a 2D spatial model users already understand from bezier handles.
- **Source:** Figma blog "How we built spring animations"; Figma spring presets (Gentle/Quick/Bouncy/Slow/Custom) with copy-pasteable values.
- **Relevance:** **Med-High** — Keyforge already generates `linear()` springs with perceptual params (`PerceptualSpring`); this replaces/augments parameter entry with the interaction designers love. Copy-pasteable numeric values map to sharing the raw `linear()` string (already possible).
- **Surface:** **M** — spring tab in EasingEditor: sample curve via `sampleSpring`, invert perceptual params from handle positions, duration handle ↔ `settleTime`.

### 3.6 `linear()` stop-graph editor mode
- **Interaction:** For any `linear(...)` easing, show the polyline with draggable stops: click line to add a point, double-click to remove, drag vertically/horizontally; presets (elastic/bounce/emphasized) seed the graph. Chrome shipped exactly this in DevTools 114/116.
- **Source:** Chrome Easing Editor linear() support; web.dev linear() article (tooling lineage).
- **Relevance:** **High** — Keyforge's spring pipeline *emits* linear(); today users can't see/tweak the generated stops except as text. Round-trips cleanly since it edits our own canonical string format.
- **Surface:** **M** — EasingEditor mode switch (bezier ⇄ stops), stop-list model, `parseLinearEasing` already exists in `spring.ts`.

### 3.7 Grouped preset taxonomy
- **Interaction:** Preset picker organized by family tabs (linear / in / out / in-out / spring / steps) with descriptive names ("Fast Out, Slow In", "In Out, Back") and the literal curve value shown on hover/selection — Chrome's table is a good curation baseline (15 named beziers + elastic/bounce/emphasized linear presets); Firefox groups presets under ease-in/out/in-out headers too.
- **Source:** Chrome Styles Easing Editor presets table; Firefox bezier editor.
- **Relevance:** **Med** — Keyforge's 14 built-ins are flat; regrouping + naming costs little and teaches curve vocabulary. Keep user library as its own group.
- **Surface:** **S** — metadata on `BUILTIN_PRESETS` entries; grouped chips in EasingEditor.

### 3.8 Motion ball preview
- **Interaction:** Any easing-canvas change plays a small looping dot/ball animating with that timing (position or opacity), so the eye verifies feel instantly. Chrome's Easing Editor triggers "a ball animation in the Preview" on every change.
- **Source:** Chrome DevTools Easing Editor.
- **Relevance:** **High** — cheap delight with real comprehension payoff; complements the existing static curve.
- **Surface:** **S** — small rAF loop inside EasingEditor using `applyEasing` (already exported).

### 3.9 Hold / steps() keyframes
- **Interaction:** Keyframe type "hold" freezes the previous value until the next keyframe (renders as stair-step glyph; AE/Rive/Cavalry/Lottie all have it). CSS-expressible via `steps(1,end)` per segment (or discrete easing); Chrome renders steps as vertical tick lines in-lane.
- **Source:** AE Hold keyframes; Rive Hold; Cavalry Step; Chrome step rendering.
- **Relevance:** **Med** — genuinely useful for cut-style animation (opacity flips, sprite steps) and fully exportable; requires widening the easing model (segment-level function type) and tokenizer support.
- **Surface:** **M** — types (`easing` union grows), EasingEditor steps tab, glyph rendering, export/import round-trip tests.

### 3.10 Default easing for new keyframes
- **Interaction:** Preference: new keys inherit the track's dominant easing or a chosen default instead of hard-coded value. Rive lets you set default interpolation for new keys.
- **Source:** Rive interpolation docs.
- **Relevance:** **Low-Med** — quality-of-life once batch tools exist.
- **Surface:** **S** — pref + one-line change in `addKeyframe` defaults.

### 3.11 Speed-graph *view* (derived, not authored)
- **Interaction:** Optional overlay plotting velocity (d|v|/dt) for a selected track over time — AE's speed graph. Crucially, treat it as a *read-only lens* in Keyforge: authoring stays bezier-based because CSS has no independent speed-curve representation; the derivative view is still excellent for diagnosing stutter/spikes (uneven peaks).
- **Source:** After Effects Graph Editor (speed vs value graphs); olafmotion/School of Motion guides.
- **Relevance:** **Med** — differentiator insight panel; must not imply editability that CSS can't express (guard rail for the no-lock-in principle).
- **Surface:** **M** — sampling + secondary plot mode in EasingEditor or a timeline overlay toggle.

---

## 4. Layering & structure

### 4.1 Parenting / precomps — mostly does NOT translate
- **What they are:** AE parenting chains transforms child→parent; precomps nest compositions. 
- **Translation analysis:** Flat CSS keyframes have no transform hierarchy; emulating parent motion requires either DOM nesting (structure the exporter doesn't control) or additive composition (`animation-composition: add/accumulate`) which composes *values*, not coordinate frames. Verdict: don't port the concepts; do keep `animation-composition` (already Phase 2) as the honest partial answer, and treat "group layers into folders" purely as an organizational feature (no runtime semantics) if layer counts grow.
- **Source:** After Effects (parenting/precomps); Cavalry pre-comps docs.
- **Relevance:** **Low** (concept) / **Med** (folder grouping, org-only). **Surface:** folder tree = M (LayerTree + store), deferred.

### 4.2 Per-layer start offsets + stagger helper
- **Interaction:** Each layer's lane starts at an offset from t=0 (rendered with Chrome-style delay hatching); a Stagger command distributes offsets across selected layers by increment (AE Sequence Layers; Lottie Duplicator; Keyforge roadmap already lists both).
- **Source:** Chrome delay drag + delay-line rendering; AE Sequence Layers; roadmap Phase 4.
- **Relevance:** **High when built** — the #1 missing structural capability; export maps to `animation-delay` (+ `fill-mode: backwards` caveat for pre-start visibility, which the hatch-shading convention communicates).
- **Surface:** **L** — doc model `delay` per layer, lane x-origin math, transport semantics, export longhand updates, import parsing.

### 4.3 Layer color identity across panels
- **Interaction:** Same-source items share one stable accent color everywhere (Chrome assigns equal colors to elements carrying the same animation): layer chip in LayerTree, its lane label, its preview outline, its CSS block header comment.
- **Source:** Chrome Animations panel color-by-animation.
- **Relevance:** **Med** — Keyforge colors lanes by track index; extending identity to layer level ties panels together visually.
- **Surface:** **S** — derive hue from layer id hash; thread through CSS vars in Timeline/Inspector/Preview.

### 4.4 Hover row ⇒ highlight element in preview
- **Interaction:** Hovering a lane/track highlights the owning element in the preview pane (Chrome highlights the animated node in the viewport on row hover; clicking jumps to Elements). Firefox likewise links rows↔nodes (node highlighter).
- **Source:** Chrome docs ("Hover over an animation to highlight it in the viewport"); Firefox inspector.
- **Relevance:** **High** — trivially cheap, closes the loop between timeline geometry and stage reality; natural sibling to existing hover states.
- **Surface:** **S** — shared hoveredLayerId signal; outline style in Preview.

### 4.5 Separate-dimensions validation
- **Interaction note (not a feature):** AE's "Separate Dimensions" splits position into X/Y channels for independent easing. Keyforge's decision to make `translate`/`rotate`/`scale` individual properties is the same idea pre-baked — worth stating in onboarding copy; also consider auto-splitting a multi-function `transform` track into component tracks on import (offer, don't force).
- **Source:** AE separate dimensions (School of Motion tutorial workflow).
- **Relevance:** **Med** — import UX refinement only.
- **Surface:** **S** — import-time suggestion in `cssImport.ts` consumers.

### 4.6 Motion blur — does NOT translate
- **What it is:** AE shutter-angle blur along motion.
- **Translation analysis:** No CSS primitive approximates true motion blur; fakes (blur filters keyed alongside movement) produce mush, not streaks. Skip; if ever needed, document a manual recipe in a techniques library entry.
- **Relevance:** **Low. Surface:** none (docs only).

---

## 5. Inspection

### 5.1 Diamond hover tooltip with full metadata
- **Interaction:** Hovering a keyframe shows: property, value, easing name + curve thumbnail, time (and %-offset), neighboring gap durations. Firefox's bar tooltip (type/duration/delays/easing/fill/rate) is the pattern; Keyforge can be richer per-stop.
- **Source:** Firefox animation inspector tooltips.
- **Relevance:** **High** — answers "what is this diamond?" without selecting; feeds power flows like §1.5 navigation.
- **Surface:** **S–M** — HTML overlay positioned from canvas coords (canvas itself shouldn't own DOM tooltips); reuse tokenize for pretty value.

### 5.2 Compositor-friendliness indicator
- **Interaction:** Badge (⚡-style) on layers/tracks whose animated properties are compositor-friendly (transform/opacity only) vs main-thread (layout-affecting width/height/color…), surfaced in the Inspector and optionally as a comment in exported CSS. Firefox marks compositor-thread animations with a lightning bolt.
- **Source:** Firefox inspector (compositor bolt); MDN perf guidance implicit.
- **Relevance:** **High** — perfectly aimed at Keyforge's developer audience; nudges exports toward jank-free results without restricting features.
- **Surface:** **S** — static classification per `AnimatableProperty`; chip in LayerTree/Inspector + export comment flag.

### 5.3 Definition-vs-iteration shading (with future iterations support)
- **Interaction:** When iteration count >1 is supported, draw first cycle solid and repeats faded (Chrome's convention) so users see definition vs repetition at a glance.
- **Source:** Chrome Animations details pane.
- **Relevance:** **Low now / Med with §2.10** (needs iterations in the model).
- **Surface:** rides along with iterations epic.

### 5.4 Live code⇄timeline sync polish
- **Interaction:** Editing `@keyframes` in the code panel updates the timeline immediately and vice versa (Firefox demos Rules-view keyframe edits reflected in the inspector). Keyforge just shipped the live-editing CSS region (#70) — the inspiration is to keep parity complete: percentage-offset edits, easing keyword swaps, and *deletions/additions* of stops should reconcile both directions with clear conflict resolution.
- **Source:** Firefox "Edit @keyframes live" flow.
- **Relevance:** **High** — core differentiator ("show code alongside"); remaining gaps likely deletions/additions reconciliation.
- **Surface:** **S–M** — extend `cssEdit.ts` round-trip coverage + tests.

### 5.5 Property-aware validation copy
- **Interaction:** Invalid token states explain domain constraints ("opacity expects 0–1", "border-radius expects ≥ 0"), matching DevTools' inline error verbosity. Already an open task in PLAN.md.
- **Source:** General DevTools styles-validation behavior; Keyforge open task.
- **Relevance:** **Med.** **Surface:** **S** — messages keyed by property in token editor.

---

## 6. Export & interop

### 6.1 Direction/fill/export flags surfaced from playback concepts
- **Interaction:** Loop-mode UI (§1.3/1.4) writes real longhands: `animation-direction: alternate`, `animation-iteration-count`, `fill-mode`. Present these as playback toggles rather than export settings so the mental model stays "what I preview is what ships."
- **Source:** Rive ping-pong; Chrome iteration display; CSS spec mapping by this catalog.
- **Relevance:** **High** — strengthens the "preview IS the output" principle.
- **Surface:** **M** (with iterations/direction fields) — export.ts longhand builder + preview wiring.

### 6.2 Annotated handoff (Figma Dev-Mode pattern)
- **Interaction:** An "export brief" mode: alongside raw CSS, emit (or copy) a human-readable spec per layer — duration, delays, easing names/values, spring parameters, compositor badge — mirroring how design teams annotate trigger/duration/easing for developers in Figma Dev Mode.
- **Source:** Figanimations/Figma Dev Mode annotation practice; Figma spring copy-paste values.
- **Relevance:** **Med** — cheap JSON/markdown emitter riding the planned Phase-3 token export; great for design-systems audience.
- **Surface:** **S** — formatter beside `exportCss`; UI copy button.

### 6.3 Single-segment snippet copy
- **Interaction:** Right-click a segment/keyframe → "Copy CSS snippet" producing a minimal self-contained `@keyframes` for just that motion (planned Phase-3 item). Lottie/AE copy-paste granularity applied to code.
- **Source:** Roadmap; LottieFiles copy/paste UX.
- **Relevance:** **Med.** **Surface:** **S** — scoped variant of existing block builder.

### 6.4 Pre-export optimizer pass
- **Interaction:** Optional "clean up before export" applying §2.8 reduction + rounding of ms values; show diff stats ("12 stops removed, −38% CSS"). Lottie markets its optimizer for exactly this payload-shrinking purpose.
- **Source:** LottieFiles Keyframe Optimizer.
- **Relevance:** **Med** — respects no-lock-in (output remains plain CSS, just leaner).
- **Surface:** **S–M** — post-process hook in export path + confirm dialog.

### 6.5 Share URL with easing library embedded
- **Interaction:** Planned share-hash should include used custom easings (named `linear()` strings + beziers) so recipients see identical timelines; Figma's inability to save custom curves is a known pain point — ours already persists locally, extend to share payloads.
- **Source:** Figma limitation noted in help docs; Keyforge roadmap.
- **Relevance:** **Med.** **Surface:** rides the share-URL epic.

---

## Appendix A — Concept translation matrix (After Effects lens)

| AE concept | Translates to CSS/WAAPI? | Keyforge disposition |
|---|---|---|
| Value graph editing (free-form curve w/ Y overshoot) | Partially — single cubic-bezier per segment allows Y overshoot; not arbitrary multi-handle curves | Adopt overshoot handles (§3.4); skip free-form graph authoring |
| Speed graph | As derived view only (§3.11) | Diagnostic overlay, read-only |
| Easy Ease / Ease In/Out assistants | Yes (preset beziers) | §3.2 |
| Keyframe Velocity influence % | Yes (handle coordinates) | §3.3 numeric fields |
| Hold keyframes | Yes (`steps(1,end)` etc.) | §3.9 |
| Auto-bezier smoothing | Yes (convert to eased) | Fold into §3.2 assistant |
| Time-reverse keyframes | Yes (`animation-direction: reverse`) or key-array reversal | §1.4 |
| Sequence Layers | Yes (`animation-delay` staggering) | §4.2 (roadmap) |
| Parenting / precomps | No (no hierarchy in flat CSS; composition ≠ frames) | Decline; org-folders at most (§4.1) |
| Motion blur | No | Decline (§4.6) |
| Separate Dimensions | Already designed-in (per-property transform tracks) | Validate import split UX (§4.5) |
| RAM preview / region preview | Editor-only | Work area §1.3 |

## Appendix B — Notable implementation patterns observed in devtools-frontend

- **Scrubber implemented as a WAAPI animation** (`#scrubberPlayer.animate(translateX…)`, rate-synced) — kindred spirit to Keyforge's WAAPI-first preview; consider driving Keyforge's playhead the same way for perfect frame alignment.
- **Render queue with per-frame time budget** (`scheduleRedraw` drains AnimationUI redraws inside ~50ms slices via rAF) — a pattern to adopt if Timeline gains per-segment glyphs + selection overlays and redraw cost grows.
- **Keyboard-operable keyframe handles** with roving tabindex + ARIA slider labels on endpoints/keys — parity target for canvas a11y beyond current focus-visible work.
- **Grid labels adapt to units** (ms vs px for scroll-driven) — precedent if `animation-timeline: scroll()/view()` support (Phase 2) lands: ruler switches units and scrubbing becomes scroll-linked rather than time-based.
