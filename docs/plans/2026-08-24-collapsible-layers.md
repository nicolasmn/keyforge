# Collapsible Layers in the Timeline

> Status: Proposal (researched against `main` @ 39054e1) — **plan only, not implemented**
> Date: 2026-08-24
> Scope: `src/components/Timeline.tsx` (canvas row model), `src/store/index.ts`, `src/types/index.ts`, `src/utils/persistence.ts`, `src/components/LayerTree.tsx`, styles.
> Goal: a collapsed layer shows **one summary row** in the timeline instead of one row per track; expanding restores today's flat track rows.

---

## 1. Current state — where rows are enumerated (the three desync sites)

Today the timeline is a **flat enumeration of track rows**: every track of every layer gets exactly `TRACK_HEIGHT = 36px`, in layer order then track order. Three independent pieces of code re-derive that same enumeration by hand:

| Site | Location | What it assumes |
|---|---|---|
| `draw()` | Timeline.tsx:160–205 | `let row = 0`; nested `layers.forEach → tracks.forEach`; `y = (HEADER_HEIGHT + row * TRACK_HEIGHT) * dpr`; `row++` per track |
| `hitTestKeyframe()` | Timeline.tsx:351–369 | Same nested loop with its own `let row = 0`; `ry = HEADER_HEIGHT + row * TRACK_HEIGHT`; band test `Math.abs(y - cy) < TRACK_HEIGHT / 2` |
| `totalTrackRows()` → `resize()` | Timeline.tsx:296–300, 302–315 | Content height = `HEADER_HEIGHT + Σ(layer.tracks.length) * TRACK_HEIGHT + CONTENT_PAD_BOTTOM` |

Two Solid effects also encode the flat model:

- Timeline.tsx:531–539 — redraw effect reads `doc.layers.map(l => l.tracks.map(...k.time))` (+ duration, playhead, selections). A `collapsed` flag change would **not** trigger this effect unless explicitly read.
- Timeline.tsx:542–545 — canvas resize effect reads `doc.layers.map(l => l.tracks.length)` only. Collapsing must change content height too.

Any collapse feature that edits these three loops independently will drift. The fix is to make row geometry a **derived, single-source-of-truth value** consumed everywhere.

Other relevant facts:

- `selectedLayerId` highlight (Timeline.tsx:164) fills every row of the selected layer with `hsl(220 12% 15%)`.
- Pointer handling: any pointerdown below the header starts scrubbing or drags a keyframe (`onPointerDown`, Timeline.tsx:400–443). A disclosure click zone must take precedence.
- Cursor logic `updateCursor()` (Timeline.tsx:339–349): ruler/playhead → `ew-resize`, keyframe → `grab`, else default.
- Precedent for per-layer booleans: `visible: boolean` lives on `Layer`, is persisted inside the doc JSON, and is consumed by Preview/css/export. There is no DOM-based disclosure anywhere yet; LayerTree already hosts real-DOM buttons (visibility toggle with `aria-label`) per layer.
- The timeline `<canvas>` has **no tabindex, role, or aria attributes** — it is invisible to AT. All accessible controls currently live in DOM siblings (LayerTree, Playback).

---

## 2. Design decision summary

1. **Row model**: new pure function `buildRowModel(layers, collapsedSet)` returns all visible rows with absolute y/height; `draw()`, hit-testing, cursor logic, and `resize()` all consume one memoized instance. No site computes `row * TRACK_HEIGHT` itself anymore.
2. **Expanded layers render exactly like today** (no extra "layer header" row when expanded) — minimal visual diff, collapse is opt-in per layer.
3. **Collapsed layers render one summary row** (chevron + name + counts + mini-density strip).
4. **State**: add optional `collapsed?: boolean` to `Layer` (persisted). Rationale in §4; an ephemeral-signal alternative is documented but rejected.
5. **LayerTree gets a matching disclosure button** — recommended, because it is simultaneously (a) the accessible implementation of toggle (real `<button aria-expanded>`), (b) the ≥44px touch target the canvas chevron can't provide, and (c) consistent with how visibility toggling already works. Cost is ~30 lines.
6. **Rider fix (recommended)**: a layer with **zero tracks** currently renders zero rows — it is literally invisible in the timeline. Render its layer row always (collapsed or not). Strictly additive; owner may decline.

---

## 3. File-level plan

### 3.1 NEW `src/utils/rowModel.ts` (+ `src/utils/rowModel.test.ts`)

Pure, no Solid imports, unit-testable in node (matches the house style of `persistence.ts`).

```ts
import type { Layer } from '@/types'

// Moved here from Timeline.tsx so the model owns the geometry constants.
export const TRACK_HEIGHT = 36
export const HEADER_HEIGHT = 28
/** Summary-row height; v1 keeps it equal to TRACK_HEIGHT (see §5). */
export const LAYER_ROW_HEIGHT = TRACK_HEIGHT
export const CONTENT_PAD_BOTTOM = 2
/** Disclosure click zone width inside the label gutter (CSS px). */
export const DISCLOSURE_ZONE_WIDTH = 24

export interface TrackRow {
  type: 'track'
  y: number        // CSS px, below ruler
  height: number   // TRACK_HEIGHT
  layerId: string
  trackId: string
}
export interface LayerRow {
  type: 'layer'
  y: number
  height: number   // LAYER_ROW_HEIGHT
  layerId: string
  trackCount: number
  kfCount: number  // total keyframes across the layer's tracks
}
export type TimelineRow = TrackRow | LayerRow

/**
 * Single source of truth for vertical layout of the lanes area.
 * A layer is collapsed iff `layer.collapsed === true` OR it appears in
 * `collapsedSet` (lets tests drive collapse without building flagged
 * Layer objects; the store passes nothing and relies on the flag).
 * Zero-track layers always emit their LayerRow (rider fix, §2.6).
 */
export function buildRowModel(
  layers: readonly Layer[],
  collapsedSet?: ReadonlySet<string>,
): TimelineRow[]

export function rowContentHeight(rows: readonly TimelineRow[]): number
// = HEADER_HEIGHT + Σ row.height + CONTENT_PAD_BOTTOM (0 rows → just padding;
//   empty-doc hint path unchanged)

export function rowIndexAt(rows: readonly TimelineRow[], yCss: number): number | null
// linear scan is fine at expected scale (<100 rows); returns null when y < HEADER_HEIGHT or past last row

export function isDisclosureZone(xCss: number): boolean
// xCss <= DISCLOSURE_ZONE_WIDTH (only meaningful within a LayerRow's band)
```

Contract notes:

- All values in **CSS px**, never device px. `draw()` multiplies by `dpr` at fill time exactly as today. Keeping dpr out of the model eliminates the classic mixed-units bug class.
- Rows are contiguous: each row's `y` equals the previous row's `y + height`. No gaps, no overlaps — asserted by tests.
- Deterministic given `(layers, collapsedSet)`; no reads of signals/stores.

### 3.2 `src/types/index.ts`

```ts
export interface Layer {
  id: string
  name: string
  visible: boolean
  /** View state: timeline shows a single summary row instead of track rows. Optional so v1 persisted docs load unchanged. */
  collapsed?: boolean
  element: LayerElement
  tracks: Track[]
}
```

### 3.3 `src/store/index.ts`

- New mutation next to `setLayerVisibility` (same produce-through-`setDoc` shape so autosave fires via `setDocWrapped`):

```ts
export function setLayerCollapsed(layerId: string, collapsed: boolean) { /* produce: find layer, assign */ }
export function toggleLayerCollapsed(layerId: string) {
  setLayerCollapsed(layerId, !(getLayer(layerId)?.collapsed === true))
}
```

- Constructors set the flag explicitly for uniform object shapes: `addLayer()` (line ~148), and `collapsed: false` added alongside `visible: true` in `src/utils/sampleDoc.ts` (3 sites) and `src/utils/cssImport.ts` (~line 264). Optional typing means none of these are load-bearing — they're consistency hygiene.

### 3.4 `src/utils/persistence.ts` — migration concerns

- `serializeDoc()` needs **no change**: it stringifies the whole doc, so `collapsed` rides along automatically.
- `validatePersisted()` currently walks fields field-by-field and returns `null` on any miss, but passes unknown/extra fields through unchecked (it even ignores `visible`). Two rules keep old saves safe:
  - **Do NOT make `collapsed` required** and do not bump `version` — a required field or version gate would reject every existing localStorage payload (`keyforge:doc:v1`), silently wiping users' docs back to `emptyDefaultDoc()`. Optional-with-default preserves both directions:
    - old payload → new app: field absent → treated as expanded ✔
    - new payload → old app (rollback): unknown field ignored by validator ✔
  - Add one normalization line inside the existing layer loop, before returning: coerce non-booleans (hand-edited storage) — `if (typeof layer.collapsed !== 'boolean') layer.collapsed = false`. Defensive, one line, mirrors the loop's existing style.
- Export surface is unaffected: `generateCss`/`cssImport` traffic CSS text only, so collapse state never leaks into user-visible artifacts.
- Tests in §6 cover round-trip and legacy payloads.

### 3.5 `src/components/Timeline.tsx` — hit-testing changes

Replace hand-rolled row math with the shared model:

- Module scope: `const rows = createMemo(() => buildRowModel(doc.layers))` (no second arg — store flag is the source of truth).
- Delete `totalTrackRows()`.
- **`hitTestKeyframe(x, y)`** rewrite:
  - `const i = rowIndexAt(rows(), y)`; if null or `rows()[i].type !== 'track'` return null (layer rows never contain keyframes — hover/cursor fall through correctly);
  - then run today's x-test (`Math.abs(x − timeToX(kf.time)) < KF_RADIUS + 8`) over that row's referenced track only. Lookup by id into `doc.layers` as today.
- New `hitTestDisclosure(x, y)`: row under y is a `LayerRow` **and** `isDisclosureZone(x)` and `y` within the row band.
- **`onPointerDown`** gains two early branches before the scrub fallback (order matters):
  1. disclosure hit → `toggleLayerCollapsed(row.layerId)`; end gesture (`endDrag()`); return. Must not start scrubbing.
  2. pointerdown lands on a `LayerRow` body → `setSelectedLayerId(row.layerId)`; end gesture; return (select-only; see open question Q2).
- `updateCursor(x, y)`: after existing branches, if `hitTestDisclosure(x,y)` → `'pointer'`; else current logic.
- Hover: `hoverKf` stays null over layer rows naturally (hitTestKeyframe returns null); optional polish: hover-highlight the disclosure triangle.

### 3.6 `src/components/Timeline.tsx` — drawing changes (summary row design)

In `draw()`, replace the nested forEach with `for (const row of rows())`, branching on `row.type`:

**TrackRow** — pixel-identical to today (bg highlight if `selectedLayerId() === row.layerId`, border hairline, `${layer.name} / ${property}` label, lane rule, diamonds with hover/selection states). Extracting today's per-track block into `drawTrackRow(ctx, row, ...)` keeps this readable.

**LayerRow (summary)** — same band height (36px), visually distinct:
- Background: selected-layer tint applies here too (§7); plus a slightly darker neutral (`hsl(220 10% 11%)`) for all layer rows so they read as group headers.
- **Chevron** ▸/▾ drawn at x ≈ 8–20, centered vertically (two-line stroke path, rotates by state). Accent color on hover.
- **Label** (bold 11px mono): layer name, then muted ` · N tracks · M kfs` appended when it fits within `LABEL_WIDTH − 28`, else truncated with ellipsis via measure-and-clip.
- **Mini-density strip** in the lane area (`LABEL_WIDTH..width−HANDLE_HIT`): one thin horizontal band per track, stacked vertically and centered in the row — band height `min(4, floor((TRACK_HEIGHT − 8) / min(trackCount, 6)))`, capped at 6 bands; layers with >6 tracks merge surplus tracks into the 6th band. Each band uses `trackColors[ti % trackColors.length]` at reduced alpha (e.g. globalAlpha 0.35) with solid 3×3px ticks at `timeToX(kf.time)` — a silent preview of what expanding reveals. Empty tracks contribute a faint baseline dash so "track exists but has no keyframes" stays legible.
- Border: full-width top hairline (in addition to the bottom one) so groups separate crisply from neighbors.

**Empty-timeline hint** and everything ruler-related is untouched. The playhead/time-chip code draws after rows and spans the full canvas height regardless of model — unchanged.

### 3.7 `src/components/Timeline.tsx` — sizing + reactive wiring

- `resize()`: `contentHeight = rowContentHeight(rows())` replaces the `HEADER_HEIGHT + totalTrackRows() * TRACK_HEIGHT + CONTENT_PAD_BOTTOM` expression.
- Redraw effect (line ~531): add `void doc.layers.map((l) => l.collapsed)` (and keep existing reads). Without this, toggling collapse wouldn't repaint.
- Resize effect (line ~542): change dependency read to `void doc.layers.map((l) => (l.collapsed ? 0 : l.tracks.length))` — or simply `void rows().length` since `buildRowModel` transitively tracks tracks-lengths and flags. Prefer the latter; one read covers both.
- `.timeline` CSS comment (app.css ~line 253) says "header + rows × TRACK_HEIGHT" — update copy to reference the row model.

### 3.8 `src/components/LayerTree.tsx` — matching control (**recommended: yes**)

Add a disclosure button as the first control inside each `SortableLayer <li>`, before the drag handle or between handle and visibility:

```tsx
<button
  class="btn btn--ghost layer-tree__disclosure"
  onClick={(e) => { e.stopPropagation(); toggleLayerCollapsed(props.layer.id) }}
  aria-expanded={props.layer.collapsed === true}
  title={props.layer.collapsed ? 'Expand layer' : 'Collapse layer'}
>
  {/* chevron SVG, rotated 90° when expanded */}
</button>
```

Why not timeline-only: the canvas cannot host focusable/AT-discoverable controls, so a timeline-only toggle would be mouse/eyes-only. The LayerTree button is the canonical accessible implementation; the canvas chevron is a mirrored convenience. State lives once (store), so the two surfaces can't disagree. This matches the existing pattern where layer-scoped actions (visibility, rename, remove) live in LayerTree while the timeline mirrors state visually.

### 3.9 Styles

- `src/styles/components.css` (wherever `.layer-tree__visibility` lives): add `.layer-tree__disclosure` (sizing matched to sibling buttons; icon rotation transition honoring `prefers-reduced-motion`, cf. motion.css conventions).

### 3.10 Accessibility strategy (given canvas limitations)

Honest framing: a drawn disclosure is not DOM, so it cannot get focus, roles, or `aria-expanded` natively. Strategy:

1. **AT users use the LayerTree button** (`aria-expanded` + `aria-label="Collapse/Expand layer X"`). Tab order reaches it naturally. This is the complete keyboard story for toggling.
2. Canvas side gets pointer affordances only: 24px-wide disclosure click zone, `cursor: pointer`, hover feedback on the chevron.
3. No new tabindex on the canvas (it remains non-focusable, as today — adding focusability without a full keyboard interaction spec would create a focus trap dead-end). A future canvas keyboard pass (arrow-key row navigation, Enter-to-toggle) can build on `rowIndexAt()`; noted as out of scope.
4. Do **not** announce collapse via live region — the LayerTree button's own `aria-expanded` state change is the correct semantic signal.

Interaction with `selectedLayerId`: collapsing the selected layer keeps selection (Inspector still targets it by id — unaffected). Highlight rule: every row whose `layerId === selectedLayerId()` gets the tint, so a collapsed selected layer shows one tinted summary row; an expanded selected layer highlights exactly what it does today. Selecting a layer whose tracks are hidden by collapse is allowed but harmless (nothing in Inspector requires the row to be visible).

---

## 4. Alternatives considered

- **Ephemeral UI state (`createSignal<ReadonlySet<string>>` in store, not persisted)**: zero schema impact, but collapse resets on reload, diverges from `visible` precedent, and still needs the row-model work. Rejected; `collapsed?: boolean` costs one optional field and normalization line.
- **Always-on layer header rows** (expanded layers also show a group row): more informative but changes today's vertical rhythm for everyone, enlarges diff and risk. Rejected for v1; the row model supports it later by emitting LayerRow unconditionally.
- **Version-bump persistence (`version: 2`)**: unnecessary churn; optional field is fully backward/forward compatible.

## Open questions (default chosen; cheap to flip)

1. Rider fix for zero-track layers rendering their LayerRow — default: **do it** (fixes invisible-layer latent bug).
2. Summary-row body click = select-only vs select+scrub — default: **select-only** (label strip is control surface, prevents surprise playhead jumps); lane-area clicks could still scrub if owner prefers.
3. Chevron zone 24px is small for touch — mitigated by the LayerTree button being the real touch target; widen canvas zone if mobile testing disagrees.

---

## 5. Implementation order (each step shippable)

1. `rowModel.ts` + tests (pure, no behavior change).
2. Timeline consumes model for draw/hitTest/cursor/resize with empty `collapsedSet` — verify pixel-parity and existing behavior.
3. Types + store mutation + constructors.
4. Persistence normalization + tests.
5. Collapse interactions: canvas disclosure zones + drawing summary rows + effects deps.
6. LayerTree disclosure button + styles.
7. Manual QA pass (checklist in §6).

Estimate: ~1 day (S–M). Steps 1–2 are mechanical refactors with zero user-visible change; collapse semantics arrive only in step 5.

---

## 6. Test list

Unit — `src/utils/rowModel.test.ts` (node, pure):

1. Flat parity: all-expanded model reproduces legacy math — row `i` has `y = HEADER_HEIGHT + i*36`, height 36, correct `(layerId, trackId)` refs.
2. Middle-collapsed layer: `[…L0 tracks, LayerRow(L1), …L2 tracks]`, ys contiguous (each `y === prev.y + prev.height`), no overlap/gap.
3. All collapsed: one LayerRow per layer, doc order preserved, counts (`trackCount`, `kfCount`) correct.
4. `collapsedSet` overrides flag; flag alone suffices without set; union semantics.
5. Zero-track layer emits LayerRow (policy test).
6. Empty doc → `[]`; `rowContentHeight([])` sane (hint path height).
7. `rowIndexAt`: above header → null; mid-band hits exact row; past bottom → null.
8. `isDisclosureZone` boundary values.

Persistence — extend `src/utils/persistence.test.ts`:

9. Legacy payload without `collapsed` loads (expanded), no rejection.
10. Non-boolean garbage (`"yes"`, `1`, `null`) normalizes to `false`.
11. Serialize→deserialize preserves `collapsed: true` (round-trip).

Store — extend `src/store/mutations.test.ts` pattern (blankDoc/setDoc harness):

12. `toggleLayerCollapsed` flips absent→true→false; unknown id is a no-op; autosave scheduling unaffected (existing save-path coverage).

Manual QA checklist:

13. Toggle via canvas chevron: collapses/expands; no accidental scrub/playhead jump; cursor `pointer` over zone, `grab` over diamonds elsewhere.
14. Toggle via LayerTree button; `aria-expanded` flips (screen-reader smoke).
15. Selected-layer tint on summary row; selecting collapsed layer keeps Inspector functional; keyframe selection/drag on other layers unaffected.
16. Resize: collapse shrinks canvas scroll height; expand regrows (ResizeObserver + effect path); many-layers-all-collapsed scrolls correctly.
17. Reload after collapsing → state restored from localStorage; clearStorage → defaults expanded.
18. Mobile (≤768px) tabbed layout: touch toggle via LayerTree; density strip legible at narrow widths.
19. Reduced-motion: chevron rotation instant.

---

## 7. Risks

- **Desync regression class returns**: the whole point is removing three hand-rolled enumerations; if a fourth consumer is ever added that recomputes rows locally, bugs come back. Mitigation: delete `totalTrackRows` outright, leave a module comment in Timeline forbidding local row math ("ask the memo"), and the model's contiguity tests catch drift early.
- **dpr/unit mixing**: model is CSS-px-only; draw multiplies by dpr at the edge. Review checkpoint: no `* dpr` inside rowModel.ts.
- **Touch ergonomics**: 24px chevron zone under 44px guidance — LayerTree button carries the accessible/touch duty; revisit zone width after device testing.
- **Behavioral surprises from rider fixes** (empty-track layers becoming visible; summary-row click no longer scrubbing): both are deliberate deviations, called out in §Open questions so the owner can veto cheaply.
- **Persistence**: low risk by construction (optional field + passthrough validator + no version bump); the one real hazard — making the field required — is explicitly forbidden in §3.4.
- **Future undo system**: collapse toggles flow through `setDocWrapped` and would land in any undo stack built on that seam. Acceptable (visible-state-like), noted for whoever builds undo.
- **Draw perf**: density strip adds O(total keyframes) fills per frame — negligible at this app's scale (dozens of kfs), same complexity class as today's diamond loop.
