# Unified Layers & Timeline — one surface, headers live on the rows

> Status: Proposal (researched against `main` @ 6e2d287) — **plan only, not implemented**
> Date: 2026-08-24
> Scope: `src/components/Timeline.tsx`, NEW `src/components/RowHeaders.tsx`, `src/utils/rowModel.ts`(+test), `src/components/LayerTree.tsx` (deleted in Phase B), `src/components/SplitLayout.tsx`(+test), `src/App.tsx`, `src/styles/app.css`, `src/styles/mobile.css`.
> Goal: the timeline's label strip becomes the **single** layer surface — every timeline row carries its own header controls (chevron, eye, name/rename, and later reorder/remove) exactly like every NLE/AE — and `LayerTree` is absorbed, widening the workspace.

---

## 1. Current-state inventory — what lives where today

### 1.1 The two surfaces

| Capability   | `LayerTree.tsx` (DOM panel)                                                                                    | `Timeline.tsx` canvas                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Selection    | item `onClick` → `setSelectedLayerId`                                                                          | layer-summary body click → select (`onPointerDown`, "select-only" comment); kf click selects owning layer           |
| Visibility   | `<button>` eye, `aria-label` Hide/Show                                                                         | **ignored** — canvas never reads `layer.visible`; only `Preview.tsx` consumes it (`visibility: hidden`)             |
| Collapse     | `<button>` chevron, `aria-expanded`                                                                            | drawn chevron ▸/▾ + `isDisclosureZone` (x ≤ 24) hit-zone, hover accent (`hoverDisclosureLayerId`), cursor `pointer` |
| Rename       | dbl-click / Enter → inline `<input>`; Esc cancel, blur commit (`renameLayer` trims, empty keeps old)           | impossible (canvas text)                                                                                            |
| Reorder      | `@thisbeyond/solid-dnd` `closestCenter`, grip handle, `DragOverlay` ghost → `reorderLayer(fromIndex, toIndex)` | none                                                                                                                |
| Add / remove | `+` in panel header; hover-revealed `✕` per item                                                               | none                                                                                                                |
| AT access    | **real buttons** — the app's only AT-discoverable layer controls                                               | none — the canvas has no tabindex/role/aria (documented in `2026-08-24-collapsible-layers.md` §1)                   |

Mobile: `LayerTree` is a dedicated "Layers" tab (`App.tsx`); coarse-pointer CSS forces `.btn` to ≥44 px and kills hover affordances.

### 1.2 Geometry facts the design must respect

- `rowModel.ts` is the single vertical-layout truth: `HEADER_HEIGHT=28`, `TRACK_HEIGHT=LAYER_ROW_HEIGHT=36`, contiguous rows, `rowIndexAt`, `rowContentHeight`. Consumers multiply by dpr at the edge.
- `LABEL_WIDTH=120` (Timeline-local): label strip is painted **on the canvas**; `timeToX/xToTime` map `[120, width]`. Ruler labels clamp to `x ≥ LABEL_WIDTH+2`.
- Keyframes at `t=0` center at exactly `x=120` with hit slop `KF_RADIUS+8=14` ⇒ grabbable band `[106, 134]`. Playhead at `t≈0` grabs `[114, 126]`. **Any DOM covering `x < 120` collides with these.**
- Today, clicking a _track_-row label scrubs/jumps the playhead (pointerdown falls through to scrub). Only _layer_ summary rows are select-not-scrub. Unification should extend "label strip ≠ scrub target" to all rows (intentional behavior change, see §5.3).
- Scroll model: `.timeline__scroll` (`overflow-y:auto`) → `<canvas>` sized `height = max(panel, rowContentHeight())`; no horizontal scroll; duration handle pinned at right edge.
- `SplitLayout`: horizontal 3-pane `H_DEFAULT_PCT=[18,56,26]`, `H_MIN_PX=[160,300,220]`, `H_MAX_PX=[320,∞,400]`; vertical `[70,30]`. `clampPanelPixels` is generic and array-length agnostic. Panel sizes are **not** persisted — changing defaults is safe.

---

## 2. Chosen architecture: **(b) DOM header column sharing the canvas scroller** ("overlay, but scroll-synced by construction")

### 2.1 Decision and rationale

A real-DOM column hosts the row headers, positioned **inside the same scroll container** as the canvas, driven by the **same `buildRowModel` output** that drives drawing:

```
.timeline__scroll                      (unchanged: overflow-y:auto)
└─ .timeline__stage                    (NEW wrapper: position:relative;
    │                                   height = max(scroller.clientHeight, rowContentHeight()))
    ├─ <canvas>                        (absolute inset:0; painting UNCHANGED except:
    │                                   no more glyphs/text inside the label strip)
    └─ .row-headers                    (absolute; left:0; top:HEADER_HEIGHT;
                                        width:HEADER_COLUMN_WIDTH)
        └─ .row-header × N             (top = row.y − HEADER_HEIGHT; height = row.height)
            ├─ chevron <button aria-expanded>
            ├─ eye     <button aria-pressed>
            ├─ name    (span → inline input on rename)
            └─ …
```

Why (b) beats (a) canvas-drawn controls:

1. **Scroll sync is designed out, not solved.** The column is an absolutely-positioned child of the stage that scrolls _with_ the canvas in the same native scroller. Zero JS scroll listeners, zero translateY bookkeeping, cannot desync at any zoom/DPR/velocity. A transform-following overlay (naive b) or sticky hacks carry exactly the fragility this plan must avoid; this variant carries none.
2. **DPR crispness is free.** Buttons/text render at native resolution; canvas keeps doing what it does well (diamonds, gridlines, strips, playhead).
3. **a11y becomes strictly better, not "preserved".** Removing LayerTree removes the app's only real buttons — option (a) would need an invisible offscreen mirror DOM (double implementation, worst of both worlds). Here every control is a genuine `<button>` with `aria-expanded`/`aria-pressed`, keyboard-focusable in layer order. Net win over today (the canvas chevron was AT-invisible).
4. **Inline rename is trivial** — an `<input>` flowing in a flexbox header, reusing LayerTree's proven editing pattern; no anchoring math.
5. **Reorder gets a home** (§4): solid-dnd needs a 1:1 ordered list of draggables. The header column supplies _exactly one row per layer regardless of collapse state_ — a property the canvas row list fundamentally lacks (collapsed layers hide their tracks). The column is the natural dnd substrate.

Why not the hybrid (c) (DOM buttons + canvas-painted names): two sources of truth for label visuals (font mismatch: canvas monospace-11px vs CSS font stack; duplicated ellipsis logic), and no compensating benefit. Full absorption into the column also makes names real text (selectable, zoomable, i18n-crisp).

### 2.2 The one genuinely tricky constraint: the `t=0` collision

Column width must stop short of `x=120` so keyframe-at-zero / playhead-at-zero grab bands stay on the canvas:

```
// rowModel.ts
export const KF_HIT_GUARD_PX = 14                       // = KF_RADIUS + old slop margin
export const HEADER_COLUMN_WIDTH = LABEL_WIDTH − KF_HIT_GUARD_PX   // 120 → 106 today
```

Canvas stops painting _any_ text/glyphs in `[0, 106)`; the 14 px guard band shows bare row background + hairlines (reads as pre-lane padding). Zero interaction regressions. `LABEL_WIDTH` itself widens to **160** in Phase A (see §3.1) so names don't starve.

### 2.3 Component ownership

`Timeline` keeps owning the stage markup and the `rows()` memo, and renders `<RowHeaders rows={rows()} … />` as a presentational child inside `.timeline__stage`. No context/store plumbing; single owner of geometry. `resize()` retargets to the stage (`canvas.parentElement` logic already adapts — it reads whatever wraps the canvas; the ResizeObserver likewise observes the stage). Explicitly: stage height = `max(stage.parentElement.clientHeight, rowContentHeight())`, replicating today's "background fills short lists" behavior.

---

## 3. Row-header spec

### 3.1 Dimensions

| Token                 | Value                                                         | Notes                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LABEL_WIDTH`         | **160** (was 120)                                             | one Timeline constant; ruler clamps, `timeToX`, wheel math, density-strip offsets all derive from it already                                                                                                                  |
| `HEADER_COLUMN_WIDTH` | 146 (= 160 − 14 guard)                                        | exported from rowModel; the DOM column's width                                                                                                                                                                                |
| Row height            | 36 desktop · **44 on `(pointer:coarse)`**                     | `buildRowModel(layers, collapsedSet?, heights?)` gains an optional heights param (defaults preserve constants; purity/tests intact). Timeline passes `{trackHeight:44, layerRowHeight:44}` from a one-shot `matchMedia` check |
| Layer header layout   | `[chevron 20][eye 20][name flex][✕ 16 (B)]` + `[grip 14 (B)]` | gaps 4 px; at 146 px Phase A leaves ≈98 px for the name (≥ today's 92); Phase B ≈68 px with ellipsis — acceptable, optionally revisit width                                                                                   |
| Track header          | indent 26 px + `track.property` muted text                    | non-interactive label; click selects owning layer                                                                                                                                                                             |

### 3.2 Controls (per layer header)

| Control          | Element                                                              | Behavior                                                                                                          |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Chevron          | `<button aria-expanded={…} aria-label="Expand/Collapse layer NAME">` | `toggleLayerCollapsed`; rotates via CSS (reuse `--ease-out-expo` transition)                                      |
| Eye              | `<button aria-pressed={!visible} aria-label="Hide/Show layer NAME">` | `setLayerVisibility`; hidden state dims header (opacity .45) **and** the layer's canvas rows                      |
| Name             | `<button>` (Enter/F2/dbl-click → rename) rendering ellipsized name   | click selects layer                                                                                               |
| Rename input     | `<input aria-label="Rename layer">` autofocus                        | Enter/blur commit via `renameLayer` (trim + fallback already in store), Esc cancels, focus returns to name button |
| Remove (Phase B) | hover-revealed `<button aria-label="Remove layer">✕`                 | `removeLayer`                                                                                                     |
| Grip (Phase B)   | hover-revealed drag handle                                           | solid-dnd sortable handle                                                                                         |

Selection styling mirrors the canvas: selected layer's headers get `--color-accent-dim` background; canvas keeps tinting lanes with `--color-row-selected`. Both read `selectedLayerId`.

### 3.3 Canvas deletions (Phase A)

Delete from `Timeline.tsx`: chevron glyph drawing, `hitTestDisclosure`, `isDisclosureZone` import/use, `hoverDisclosureLayerId`, the `'pointer'` cursor branch, layer-name + suffix painting, track-row `layer.name / track.property` painting. Keep: row backgrounds, hairlines (full width — they stitch under the column), gridlines, diamonds, mini-density strips, ruler, playhead, ghosts, empty-state hint. Add: `if (!layer.visible) ctx.globalAlpha = 0.35` band around a layer's rows (dim = hidden, matching AE).

---

## 4. Interaction specs

### 4.1 Reorder — **keep drag-to-reorder, moved onto the header column (Phase B)**

Honest assessment: dropping reorder would be a real regression (core NLE muscle memory; layer order is authored meaning — z-order in preview). Two options:

- **Chosen: solid-dnd inside the column.** Wrap the column's layer headers in `DragDropProvider`/`SortableProvider` (closestCenter), grip handle on hover, `DragOverlay` ghost styled like today's `.layer-tree__drag-ghost`, `onDragEnd` → existing `reorderLayer(fromIndex, toIndex)` verbatim. The column's killer property makes this robust: headers are always exactly the ordered layer list — collapse states don't perturb indices (unlike canvas rows, where a collapsed layer removes N rows from the coordinate space mid-drag). Proven library, touch sensors included.
- **Rejected for v1: canvas drag-band reorder** (long-press + vertical drag with insertion indicator). Must hand-roll: slop-vs-click disambiguation, autoscroll at container edges, indicator hit-testing, touch long-press semantics on a `touch-action:none` surface. Weeks of edge cases vs. ~80 lines moving existing code. Document as a possible later enhancement (dragging a row by its lane background), not a requirement.

### 4.2 Rename

dbl-click or Enter/F2 on the focused name button swaps span→input in place (flexbox handles layout; **no anchoring math anywhere**). Commit semantics copied from LayerTree: Enter commits, blur commits, Escape cancels and restores focus. Store call unchanged (`renameLayer` trims; empty string keeps prior name).

### 4.3 Select

Clicking any part of a layer header selects the layer. Clicking a track header selects its owning layer (parity with kf-click selecting the layer for the Inspector). Canvas behaviors unchanged (summary-body select, kf select). Label strip never scrubs — see §5.3.

### 4.4 Collapse

Chevron button replaces the canvas disclosure zone entirely. Expanded ⇄ summary-row swap flows through `buildRowModel`; because both canvas and column consume the same memo, rows re-flow in lockstep the same frame. Summary row keeps its canvas mini-density strip (lanes side) and counts suffix can move into the header as muted text when space allows (optional).

### 4.5 Add / Remove (Phase B)

Ghost row appended at column end: `+ Add layer` (muted, dashed underline on hover) → `addLayer()`. Per-layer `✕` hover-revealed with confirm-free delete parity with today. Empty doc keeps the canvas hint plus the ghost add-row.

---

## 5. LayerTree fate + SplitLayout changes

**Recommendation: full absorption (delete LayerTree in Phase B).** Keeping it "optional" preserves exactly the dual-surface drift this mission exists to kill (two reorder UIs, two collapse affordances, double maintenance), and the collapsible-layers plan already established the pattern that DOM controls mirror canvas ones — unification collapses that pairing into one DOM surface. Nothing in LayerTree survives as code except patterns already being transplanted (rename editing block, dnd handler, icon SVGs).

### 5.1 SplitLayout (desktop)

Horizontal split becomes **2-pane: Preview | Inspector**:

```ts
const H_DEFAULT_PCT = [68, 32] // was [18, 56, 26]
const H_MIN_PX = [300, 220] // was [160, 300, 220]
const H_MAX_PX = [Infinity, 400] // was [320, Infinity, 400]
```

Mechanical change: drop the `layerTree` prop/ref/panel, shrink the arrays. `clampPanelPixels` is length-generic — untouched; `SplitLayout.test.ts` gains a 2-panel case. Gutter dbl-click reset and window-resize reclamp work unchanged. No persisted sizes exist, so no migration.

### 5.2 Mobile

The "Layers" tab dies (its content now rides inside the Preview tab's embedded Timeline headers). Tabs become **Preview | Inspector** (+ theme slot). At ≤480 px render the column at 132 px (pass a width override prop; guard band scales with it). Verify 375 px devices leave ≥200 px of lane.

### 5.3 Intentional behavior changes to call out in review

1. Clicking a _track_ label no longer scrubs/jumps the playhead (previously fell through to scrub) — consistent with the established "label strip is a control surface" rule for summary rows.
2. Hidden layers dim in the timeline instead of being ignored (they were never removed — row-model identity depends on them staying put).
3. Names become selectable/copyable text (canvas text wasn't).

---

## 6. Phases

### Phase A — unify controls onto timeline rows (LayerTree stays put)

Scope: stage wrapper + `RowHeaders` (chevron/eye/name+rename/select), canvas glyph deletions, hidden-layer dimming, `LABEL_WIDTH`→160, coarse-pointer 44 px rows, guard band.

**Acceptance criteria**

1. From the timeline alone: collapse (with `aria-expanded`), show/hide (with `aria-pressed`), rename (dbl-click/Enter → inline input; Esc cancels; Enter/blur commits trimmed value; empty input keeps old name), select — all functional; canvas contains **zero** chevron/disclosure code paths (`rg hitTestDisclosure` empty).
2. Headers stay glued to their lanes through the full scroll range at DPR 1 / 1.5 / 2 and browser zoom 100 %–200 %, with no JS scroll listeners (grep-able assertion: no `scrollTop` writes outside `resize`).
3. A keyframe at `t=0` and a playhead at `t≈0` remain grabbable (guard band verified manually).
4. Hidden layer: dimmed lanes + header; Preview hides it; toggling back restores.
5. Keyboard-only pass: Tab reaches every header control in layer order; Enter activates; focus rings visible; rename round-trips without mouse.
6. LayerTree untouched and still functional (reorder/add/remove live there for now); all existing suites (`vitest`) green; new `rowModel` heights-param tests added.
7. Visual diff limited to the label strip: lanes/ruler/playhead pixel-parity checked side-by-side against `main`.

### Phase B — full absorption + shell simplification

Scope: transplant dnd (grip + DragOverlay + `reorderLayer`), add ghost row, remove `✕`, delete `LayerTree.tsx` + its CSS blocks + mobile tab + `App` wiring, SplitLayout 2-pane, mobile tab reduction.

**Acceptance criteria**

1. `rg -n "LayerTree|layer-tree"` over `src/` returns nothing (component, classes, CSS, mobile overrides gone).
2. Reorder on the header column: grip-drag updates `doc.layers` order (persisted doc reflects it after reload); works with collapsed layers mixed in; ghost + insertion feedback present; keyboard alternative exists (move-layer buttons or documented limitation — pick one explicitly in review).
3. `+ Add layer` ghost row and hover `✕` removal work; `✕` has `aria-label`.
4. Desktop shell is Preview | Inspector; dbl-click gutter resets to `[68,32]`; resize reclamp holds mins/maxes; `SplitLayout.test.ts` covers 2-panel clamping.
5. Mobile: two tabs; timeline headers usable at 375 px (column 132 px, no horizontal clipping of the ruler's duration chip).
6. Full manual QA checklist (§7.3) passes; `npm run lint`, typecheck, `vitest` green.

---

## 7. Test plan

### 7.1 Unit (vitest)

- `rowModel.test.ts`: heights param (defaults byte-identical to today; 44 px variant stays contiguous; `rowContentHeight` honors it); `HEADER_COLUMN_WIDTH` derivation.
- New `rowHeaders.test.ts` (pure helpers extracted from the component): `headerEntries(rows)` → one entry per canvas row with `top = y − HEADER_HEIGHT`, plus the invariant **exactly one layer-header per layer, in layer order, regardless of collapse** (the dnd-correctness property).
- `SplitLayout.test.ts`: 2-panel `clampPanelPixels` case (min-sum > available degenerate case too).
- `mutations.test.ts`: no changes expected (`reorderLayer`/`renameLayer` reused verbatim) — assert existing coverage still passes.

### 7.2 Static/CI

`npm run lint`, `tsc --noEmit`, `vitest run`.

### 7.3 Manual QA matrix

Scrub · kf drag + snap ghost · duration-handle drag + touch tap prompt · wheel-horizontal playhead · collapse/expand reflow with density strips · rename via mouse & keyboard · visibility toggle vs Preview · hidden-dim rendering · selection sync (canvas→header, header→Inspector) · dnd reorder incl. drag-near-edge · theme flip (column uses CSS vars directly — should just work; canvas repaint path unchanged) · zoom/DPR sweep · 375 px mobile pass.

---

## 8. Risks & mitigations

| Risk                                   | Reality                                                                                               | Mitigation                                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scroll desync (classic overlay killer) | **Designed out**: column is a flow-positioned sibling inside the same native scroller; no JS involved | Acceptance A2 asserts no scrollTop writes                                                                                                                           |
| DPR blur                               | DOM column immune; canvas untouched                                                                   | None needed                                                                                                                                                         |
| Touch targets < 44 px on 36 px rows    | Real                                                                                                  | Coarse-pointer bumps row heights to 44 via `buildRowModel` heights param + `.btn`-style min sizes on header buttons                                                 |
| `t=0` kf/playhead under the column     | Real geometry collision                                                                               | 14 px guard band (`HEADER_COLUMN_WIDTH`); acceptance A3                                                                                                             |
| dnd lacks container autoscroll         | solid-dnd doesn't auto-scroll ancestors                                                               | Small rAF autoscroll helper when pointer nears scroller edges during drag (~30 lines), or ship-v1 with documented limit if row counts stay small — decide at review |
| Narrow column starves names            | 146 px minus controls                                                                                 | `LABEL_WIDTH`=160 now; ellipsis everywhere; optional width prop per breakpoint                                                                                      |
| Muscle-memory loss for tree users      | Owner-driven change                                                                                   | Ghost add-row + hover affordances ease transition; Inspector untouched                                                                                              |
| Split.js defaults drift                | None — sizes aren't persisted                                                                         | Fresh defaults safe                                                                                                                                                 |

## 9. Explicitly out of scope

Canvas-side multi-select/marquee, layer grouping/nesting, per-track headers with own controls, drag-by-lane-background reordering (possible future enhancement), persistence schema changes (none required — `visible`/`collapsed` already exist and persist).
