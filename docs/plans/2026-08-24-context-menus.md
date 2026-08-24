# Right-Click Context Menus — unified system + per-target actions

> Status: Proposal (researched against `main` @ 6e2d287) — **plan only, not implemented**
> Date: 2026-08-24
> Scope: NEW `src/components/ContextMenu.tsx` (+ service), `src/utils/menuPosition.ts` (+ tests), `src/components/Timeline.tsx`, `src/components/LayerTree.tsx`, Phase B `src/components/Inspector.tsx`, `src/store/index.ts` (+ tests), styles.
> Goal: one app-wide context-menu primitive; right-click menus on the timeline canvas (keyframe / track lane / layer summary row), LayerTree rows, and (Phase B) Inspector keyframe rows.
> Store gap total: **2 new doc mutations** (`duplicateLayer`, `duplicateKeyframe`). Everything else maps onto existing mutations.

---

## 1. Current state — what exists to build on

### 1.1 Hit-testing on the canvas is already complete

Timeline.tsx exposes every primitive a hit-test-driven menu needs:

| Helper | Location | Gives us |
| --- | --- | --- |
| `cssX(e)` / `cssY(e)` | Timeline.tsx:556–562 | CSS-px coords inside the canvas (work for `MouseEvent` too) |
| `rows()` memo → `buildRowModel(doc.layers)` | Timeline.tsx:79, utils/rowModel.ts | Every visible row's y-band, type (`track` \| `layer`), ids, counts |
| `rowIndexAt(rows, y)` | rowModel.ts:116 | Row under a y (null over ruler / past last row) |
| `isDisclosureZone(x)` | rowModel.ts:129 | Whether x sits in the chevron strip (`≤ 24px`) |
| `hitTestKeyframe(x, y)` | Timeline.tsx:595–611 | `{layerId, trackId, kfId}` of the diamond under the point |
| `hitTestDisclosure(x, y)` | Timeline.tsx:614–620 | `LayerRow` when the point is in a layer row's chevron zone |
| `timeToX` / `xToTime` | Timeline.tsx:81–90 | ↔ conversion for "add keyframe at position" |

The canvas has no DOM per object — confirmed. Menus must anchor at **viewport coordinates** (`e.clientX/clientY`) in a fixed-position portal; item lists are computed from these helpers at open time.

### 1.2 Existing menu recipes to reuse

- **`.kf-doc-menu`** (DocBar #83): popover surface reusing `.kf-stack-picker` tokens (surface bg, border, radius-md, color-mix shadow), `role="menu"` + `[role="menuitem"]`, z-index 60 (below the modal scrim's z-100). Styles live in app.css ~643–700.
- **The uniform #48 close contract** (implemented in DocBar.tsx:203–268): document-level `pointerdown` closes when target is outside the menu root; `keydown` Escape closes as fallback when focus has left; per-root handler owns Escape while focus is inside and refocuses the trigger; `focusout` closes when focus leaves the root; Arrow/Home/End rove items by querying `[role="menuitem"]`.
- **`runMenuAction(kind, action)`** (DocBar.tsx:191–195): close first → restore focus → *then* run the action, so modals/file-pickers open from a sane anchor. Context menus must copy this ordering.
- **Portal precedent**: Inspector mounts its `<datalist>` host via `render()` into a `document.body` child (Inspector.tsx:162–178) — same technique serves the single context-menu host.

### 1.3 Mutation inventory (what menus can already call)

Existing, all autosave-safe through `setDoc`: `addLayer`, `removeLayer`, `renameLayer`, `reorderLayer(from,to)`, `setLayerVisibility`, `setLayerCollapsed`, `toggleLayerCollapsed`, `addTrack`, `removeTrack`, `addKeyframe(layerId, trackId, kf)` (with smart-default value logic), `updateKeyframe(…, patch{time|value|easing})`, `removeKeyframe`, `setDuration`; selection setters `setSelectedLayerId` / `setSelectedKeyframeId`; batch easing helper `easeAllTrackKeyframes(layerId, track, easing, updateKeyframe)` (utils/easingAssistant.ts).

**Missing** (verified — only `duplicateProject` exists):

1. `duplicateLayer(layerId)` — no deep-copy-with-fresh-ids for a single layer anywhere. `cloneDocWithFreshIds` (utils/projects.ts:290+) demonstrates the fresh-id discipline but operates on whole docs.
2. `duplicateKeyframe(layerId, trackId, keyframeId, opts?)`.

### 1.4 Latent bug this feature must fix first

`onPointerDown` (Timeline.tsx:663) never checks `e.button`. **Right-button presses currently start scrubbing** (ghost chip, playhead jump, pointer capture) before `contextmenu` fires. Any context-menu work must begin with a primary-button guard (`if (e.pointerType === 'mouse' && e.button !== 0) return`), otherwise right-click visibly scrubs the playhead on Windows/Linux (mouseup-ordered) and macOS (mousedown-ordered). This is Step 0 and is independently shippable.

---

## 2. Design decisions (the four questions)

### D1. Native `contextmenu` suppression — opt-in per surface

- Each component attaches its own `onContextMenu` where menus apply. The handler runs the target hit-test; it calls `e.preventDefault()` **only when it actually opens a custom menu** (or when a custom menu is already open anywhere).
- Miss = native menu stays: ruler area and empty lanes-below-rows region keep the browser default (DevTools, spellcheck, image save all still work); `<textarea>`s (CSS import, CodeView) and text inputs are never wired, so their cut/copy/paste native menus are untouched.
- While a context menu is open, its own `pointerdown` outside-closer (#48 pattern) handles dismissal; we additionally suppress a second `contextmenu` event landing on the open menu itself (preventDefault + close-and-reopen semantics: right-clicking elsewhere while open simply moves the menu if the new position hits a known target, closes it otherwise).
- No global `contextmenu` preventDefault listener. Ever.

### D2. Positioning near cursor without viewport overflow

Pure function in NEW `src/utils/menuPosition.ts` (node-testable, matches rowModel house style):

```ts
export interface MenuPlacement { left: number; top: number }
export const MENU_VIEWPORT_MARGIN = 8;
export function placeMenu(
  x: number, y: number,          // desired anchor (viewport px)
  w: number, h: number,          // measured menu box (offsetWidth/Height)
  vw: number, vh: number,        // viewport (innerWidth/innerHeight)
): MenuPlacement
```

Rules: default `left = x, top = y`; flip horizontally when `x + w + margin > vw` → `left = x - w`; flip vertically when `y + h + margin > vh` → `top = y - h`; then clamp both axes into `[margin, vw - w - margin]` / `[margin, vh - h - margin]`. The host measures after mount (ref `offsetWidth/offsetHeight` in a `queueMicrotask`) and applies placement once — menus here are short (≤8 items), so no scroll-in-place complexity; if a future submenu ever exceeds viewport height, cap height + `overflow-y:auto` instead of scrolling the page.

### D3. Keyboard invocation (Shift+F10 / Menu key) — YES for DOM targets, honest no-op on canvas

Recommendation: **support it**, essentially for free. Browsers synthesize a `contextmenu` event for Shift+F10 / the Menu key at the focused element, so the same handlers written for mouse right-click serve keyboard users on LayerTree rows (Phase A) and Inspector rows (Phase B) with zero extra code — rows just need `tabindex={0}` (the tree's name span already has it; add it to the `<li>` wrapper). On the **canvas**, the element is deliberately non-focusable (collapsible-layers plan §3.10 decision: no tabindex without a full keyboard spec), so a keyboard-invoked canvas menu is impossible until that pass happens — the accessible path for every canvas action remains LayerTree buttons + Inspector controls, exactly like today. Documented honestly; not a regression.

### D4. Submenus — NOT needed; flat lists stay under the flip threshold

Every proposed menu fits in ≤6 flat items (see §4). Easing choices ship as two direct commands ("Easy-ease key", "Set hold") rather than an easing submenu. The `MenuItem` union below omits `children`; if Phase C+ ever needs nesting, extend the union with `{type:'submenu'}` and render a nested `.kf-ctx-menu` offset to the side (flip-aware via the same `placeMenu`) — no API break.

---

## 3. Shared component API

### 3.1 Service shape (module-level singleton, one instance app-wide)

```ts
// src/components/ContextMenu.tsx
export type MenuItem =
  | { type: 'item'; label: string; onSelect: () => void
      disabled?: boolean; danger?: boolean; hint?: string }  // hint = shortcut text, e.g. "Del"
  | { type: 'separator' }

export interface ContextMenuOptions {
  ariaLabel?: string            // announced role=menu name ("Layer row actions")
  onClose?: () => void          // dismissed without selection (Escape/outside/scroll)
}

export const contextMenu = {
  /** Open (or move/reopen) THE menu at viewport coords. Closes any prior instance. */
  open(x: number, y: number, items: MenuItem[], opts?: ContextMenuOptions): void,
  close(): void,
  isOpen(): boolean,
}

/** Mounted once, in <App/>: renders nothing until open(). Body-portaled, fixed-position. */
export function ContextMenuHost(): JSX.Element
```

Three-line summary: `open(x, y, items)` shows one global fixed-positioned `role="menu"` portal anchored at viewport coords with flip/clamp placement; `items` is a flat data array (`item`/`separator`) evaluated at call time, each carrying its own `onSelect`; the host owns the full #48 lifecycle — focus first enabled item, Arrow/Home/End rove, Enter/Space activate (close → restore focus → run), Escape/outside-pointerdown/focus-out/window-blur/**scroll(capture)** close.

Design notes:
- **Single instance**: `open()` replaces state wholesale — no stacking, matches "exactly one cluster menu open" precedent (audit F15).
- **Close on scroll (capture)**: menus anchor to viewport coords; any scroll invalidates the anchor silently. Closing is the correct, simple behavior (native OS menus behave likewise). `scroll` listener registered with `{capture: true}` catches the timeline's own scroller.
- **Focus contract**: opening always moves focus into the menu (first enabled item). Mouse users lose nothing (no text selection to preserve on canvas/tree rows); keyboard users land where they expect. Close restores focus to `document.activeElement` captured at open time (the #48 restoration rule generalized — there is no trigger button to return to).
- **Danger styling**: `.kf-ctx-menu__item--danger` (delete/danger-color text) mirrors how destructive actions read elsewhere.
- **Styles**: NEW `.kf-ctx-menu` in components.css, copying the `.kf-doc-menu` recipe verbatim (surface/border/radius/shadow tokens) minus `right:0` anchoring — positioned by inline `left/top` from `placeMenu()`. Same z-index 60 tier.

### 3.2 Why a service, not per-component state

DocBar's local two-menu signals work because triggers are visible anchors. Context menus have no trigger element and three unrelated origins; a singleton removes the "two panels opened menus simultaneously" class entirely and gives tests one seam to assert on.

---

## 4. Per-target action tables

Convention: ✅ existing mutation · 🆕 NEW mutation · ⚙ UI-only. All selections happen **before** the menu opens (right-click selects what's under the cursor — standard NLE behavior — so Inspector cross-highlight F11 follows for free).

### 4.1 Timeline canvas — keyframe diamond (`hitTestKeyframe`)

| Item | Action | Mutation |
| --- | --- | --- |
| Duplicate keyframe | clone at `time + snapIncrement-or-default-offset`, fresh id, same value/easing; select the copy | 🆕 `duplicateKeyframe(layerId, trackId, kfId, atTime?)` |
| Easy-ease key | set `easing: 'ease-out'` (`EASY_EASE_EASING`) on this key | ✅ `updateKeyframe(…, { easing })` |
| Set hold | set `easing: 'steps(1, end)'` on this key | ✅ `updateKeyframe(…, { easing })` |
| Edit curve… | select key (already done) + focus the Inspector easing chip (scroll-into-view rides F11) | ⚙ `setSelectedKeyframeId` (already selected) |
| ― separator ― | | |
| Delete keyframe | remove | ✅ `removeKeyframe(layerId, trackId, kfId)` |

Also: `setSelectedKeyframeId(kfId)` + `setSelectedLayerId(layerId)` + `setKeyframeSelectionSource('canvas')` fire at open time (mirrors onPointerDown:706–716).

### 4.2 Timeline canvas — track lane (`rowIndexAt` → `TrackRow`, x beyond label gutter)

| Item | Action | Mutation |
| --- | --- | --- |
| Add keyframe here | `addKeyframe(layerId, trackId, { time: snapTime(xToTime(x)), value: '', easing: 'ease-out' })` — empty value triggers the store's smart-default capture (store/index.ts:601–629) | ✅ `addKeyframe` |
| Easy-ease track | ease every key of this track | ✅ `easeAllTrackKeyframes(…)` |
| Clear track | remove track + its keys (matches the Inspector ✕ semantics; transform-stack merge guards make this safe per #66/#79) | ✅ `removeTrack(layerId, trackId)` |

Right-click also selects the owning layer (`setSelectedLayerId(row.layerId)`).

### 4.3 Timeline canvas — layer summary row (`rowIndexAt` → `LayerRow`)

| Item | Action | Mutation |
| --- | --- | --- |
| Collapse / Expand (label flips on `layer.collapsed`) | toggle | ✅ `toggleLayerCollapsed(layerId)` |
| Rename… | start the LayerTree inline edit for this layer | ⚙ rename-bus (below) → ✅ `renameLayer` on commit |
| Duplicate layer | deep-copy layer + tracks + kfs with fresh ids, insert directly after source, select copy | 🆕 `duplicateLayer(layerId)` |
| ― separator ― | | |
| Delete layer | remove | ✅ `removeLayer(layerId)` (danger) |

Rename plumbing (⚙ UI-only, not a store mutation): export a tiny signal from LayerTree module scope — `const [renameTargetId, requestLayerRename] = createSignal<string|null>(null)` — consumed by the existing `editingId` mechanism (SortableLayer enters edit mode when `props.layer.id === renameTargetId()`). Keeps ONE rename editor implementation; the canvas menu merely points at it. (Fallback alternative if owner dislikes cross-component coupling: `window.prompt('Rename layer', …)` mirroring `promptDuration()` — cheaper, uglier.)

### 4.4 LayerTree rows (`<li>` gets `onContextMenu` + `tabindex={0}`)

| Item | Action | Mutation |
| --- | --- | --- |
| Rename… | enter inline edit | ⚙ same bus → ✅ `renameLayer` |
| Duplicate layer | as §4.3 | 🆕 `duplicateLayer(layerId)` |
| Collapse/Expand in timeline | mirrors canvas chevron | ✅ `toggleLayerCollapsed` |
| Move up / Move down | `reorderLayer(i, i−1)` / `reorderLayer(i, i+1)` clamped; both hidden (not disabled) at edges | ✅ `reorderLayer` |
| ― separator ― | | |
| Delete layer | | ✅ `removeLayer` (danger) |

Move up/down is the keyboard-free dnd alternative the mission asked for; drag handle untouched.

### 4.5 Inspector keyframe rows — **Phase B**

| Item | Action | Mutation |
| --- | --- | --- |
| Copy value | `navigator.clipboard.writeText(kf.value)` | ⚙ clipboard |
| Paste value | `navigator.clipboard.readText()` → validate non-empty → `updateKeyframe(…, { value })` (readText may reject without permission → catch, no-op; empty/garbage already guarded by store) | ✅ `updateKeyframe` |
| Delete keyframe | | ✅ `removeKeyframe` |

Worth it? Moderately — copy/paste between keys is real workflow but low-frequency; delete already has a dedicated ✕. Defer to Phase B as planned; do NOT let it gate Phase A.

---

## 5. New store mutations (the complete gap list)

Both go in `src/store/index.ts`, standard `produce`-through-`setDoc` shape so autosave fires:

```ts
/** Deep-copy layer with fresh entity ids, inserted directly after the source.
 *  Name suffixed " copy" via uniqueName against sibling layers. Returns new id
 *  (null when unknown id). Selects the copy. Mirrors duplicateProject discipline:
 *  fresh ids guarantee zero aliasing between source and copy entities. */
export function duplicateLayer(layerId: string): string | null

/** Clone one keyframe (same value/easing, fresh id) at `atTime ?? time + defaultOffset`
 *  (defaultOffset = snapIncrement() when active else 100ms), clamped to [0, duration].
 *  Re-sorts the track; returns the new id (null on unknown ids). Does NOT change selection. */
export function duplicateKeyframe(
  layerId: string, trackId: string, keyframeId: string, atTime?: number,
): string | null
```

Count: **2**. Everything else in §4 is an existing mutation or UI-only plumbing (the rename-request signal).

---

## 6. File-level plan

### 6.0 Step 0 — `Timeline.tsx`: right-button guard (prerequisite bugfix)

First lines of `onPointerDown`: ignore non-primary buttons for mice (`if (e.pointerType === 'mouse' && e.button !== 0) return`). Pen/touch unaffected. Kills today's right-click-scrub latent bug (§1.4). Shippable alone.

### 6.1 NEW `src/components/ContextMenu.tsx`

Service object + `ContextMenuHost` component per §3. Host internals: body-portal via `render()` (datalist precedent); `<div class="kf-ctx-menu" role="menu">` with `<button role="menuitem" class="kf-ctx-menu__item">` children; separators render `<hr role="separator">`. Lifecycle listeners mounted while open: document `pointerdown` closer (#83 copy), `keydown` for Escape/Arrow/Home/End/Enter/Space/Tab, window `blur`, document `scroll` capture, `resize`. Placement: initial `visibility:hidden` mount → measure `offsetWidth/Height` in microtask → apply `placeMenu()` → show (avoids first-frame flicker at flipped positions). Focus: first enabled menuitem. Restore focus to the element recorded at `open()` on every close path.

### 6.2 NEW `src/utils/menuPosition.ts` (+ `.test.ts`)

`placeMenu()` per D2. Pure; no DOM imports; node-testable.

### 6.3 `src/store/index.ts`

`duplicateLayer` + `duplicateKeyframe` per §5 (+ tests in `mutations.test.ts` harness style).

### 6.4 `src/components/Timeline.tsx`

Add `onContextMenu={onContextMenu}` to the canvas. Handler sketch:

```
if (activePointerId !== null) return            // never mid-gesture
endDrag()                                        // belt: clear any residual gesture state
const x = cssX(e), y = cssY(e)
if (y < HEADER_HEIGHT) return                    // ruler keeps native menu
const kf = hitTestKeyframe(x, y)
if (kf) { select(kf) ; contextMenu.open(e.clientX, e.clientY, kfItems(kf)) ; e.preventDefault(); return }
const i = rowIndexAt(rows(), y)
const row = i !== null ? rows()[i] : null
if (row?.type === 'track') { setSelectedLayerId(row.layerId); open(e.clientX, e.clientY, laneItems(row, x)) ; e.preventDefault(); return }
if (row?.type === 'layer') { setSelectedLayerId(row.layerId); open(e.clientX, e.clientY, layerItems(row)) ; e.preventDefault(); return }
// else: fall through — native menu preserved below last row / in gutter
```

Item builders are plain functions returning `MenuItem[]` evaluated at open time (collapse-label flip, edge-disabled move items, etc.).

### 6.5 `src/components/LayerTree.tsx`

- Export `requestLayerRename` signal; wire `editingId` to consume it (one line: effective editing id = `editingId() ?? renameTargetId()`).
- `<li>` gains `tabindex={0}` + `onContextMenu={(e) => { e.preventDefault(); setSelectedLayerId(id); contextMenu.open(e.clientX, e.clientY, treeRowItems(layer)) }}` (Shift+F10 works automatically per D3).
- Stop propagation from inner buttons so right-click on visibility/collapse buttons still opens the row menu consistently (they have no own menus).

### 6.6 Styles — `src/styles/components.css`

`.kf-ctx-menu` + `__item` (+ `--danger`, `__hint`, `--separator`), copied from `.kf-doc-menu` recipe; `min-width: 10rem`; `position: fixed` (not absolute); reduced-motion: none needed (instant show/hide).

### 6.7 Phase B — `Inspector.tsx`

Same pattern on `.kf-row` (§4.5). Nothing in Phase A blocks or precludes it; `MenuItem`/service unchanged.

---

## 7. Accessibility notes

1. Roles mirror DocBar: `role="menu"` + `role="menuitem"`; separators `role="separator"`; `aria-label` names each menu ("Keyframe actions", "Layer actions", …).
2. Focus is moved into the menu on open and restored to the pre-open `activeElement` on every close path — the #48 contract generalized to trigger-less menus.
3. Keyboard: arrows/Home/End rove skipping separators & disabled items; Enter/Space activate; Escape closes + restores; Tab closes (natural order continues). Shift+F10/Menu-key support arrives free on DOM targets (D3); canvas remains pointer-only by the standing no-tabindex decision, with LayerTree as the AT-complete equivalent surface (same rationale as the collapsible-layers disclosure).
4. Screen-reader announcement of *actions taken* is owned by the mutations' existing surfaces (selection changes, Inspector updates) — no extra live regions; matches the collapsible-layers plan stance.
5. Touch: Android long-press fires `contextmenu` (works); iOS Safari does not — touch users keep every affordance they have today (buttons, +KF, Easy-ease). Not a regression; noted as out of scope.

---

## 8. Implementation order (each step shippable)

1. **Step 0**: primary-button guard in `onPointerDown` (bugfix; no feature).
2. `menuPosition.ts` + tests (pure).
3. Store: `duplicateLayer` + `duplicateKeyframe` + tests.
4. `ContextMenu.tsx` service/host + styles; mount `<ContextMenuHost/>` in App.
5. LayerTree row menus + rename bus.
6. Timeline canvas menus (keyframe → lane → layer-row builders).
7. Manual QA pass (checklist §9).

Phase A = steps 1–7. Phase B = Inspector row menus (§6.7) as a follow-up PR reusing everything.

Estimate: Phase A ~1 day; Phase B ~half day (mostly QA).

---

## 9. Test list

Unit — `menuPosition.test.ts` (node):
1. Default placement at cursor; margins respected.
2. Right-edge flip (`x + w > vw − margin`) → left-aligned to cursor; bottom-edge flip → above cursor.
3. Corner case (bottom-right): both axes flip; still within viewport.
4. Clamp: huge menu near origin clamps to margin, never negative.
5. Menu larger than viewport: clamped to margin (degenerate but defined).

Store — extend `mutations.test.ts`:
6. `duplicateLayer`: fresh ids everywhere (ids ∩ source ids = ∅), inserted immediately after source, name `"X copy"` uniquified against siblings, returns new id, selection moves to copy, autosave scheduled.
7. `duplicateLayer` unknown id → null, no write.
8. `duplicateKeyframe`: copies value/easing, fresh id, lands at requested `atTime` (and default offset otherwise), clamps ≥0 and ≤duration, track re-sorted, selection untouched.
9. `duplicateKeyframe` unknown layer/track/kf → null, no write.

Manual QA checklist:
10. Canvas: right-click diamond/lane/summary row → correct menus; right-click ruler and below-last-row → NATIVE menu appears; textarea/import dialog keeps native cut/paste.
11. Right-click does NOT scrub/playhead-jump anywhere (Step 0 verified); mid-drag right-click ignored.
12. Right-click unselected keyframe selects it; Inspector follows (F11 cross-highlight intact); Delete/Duplicate act on that key.
13. Flip behavior: menus near right/bottom edges flip inward; nothing clips.
14. Keyboard: Tab to a tree row → Shift+F10 opens; arrows/Enter activate Move up/down; Escape restores focus to the row.
15. Close paths: outside click, second right-click elsewhere (moves/closes), Escape, window blur, scrolling the timeline panel — all close; no orphan menu after project switch (`openProject` should close any open menu via scroll/state reset — verify; add explicit `contextMenu.close()` in `resetTransientState` if not).
16. Actions round-trip: duplicate layer → undo-less safety (fresh ids, exports valid); collapse from menu matches chevron; clear track leaves other tracks untouched.
17. Light theme: menu tokens correct (color-mix shadow recipe).
18. Reduced-motion: instant open/close (no transitions added anyway).

---

## 10. Risks

- **Suppression creep**: pressure to `preventDefault` globally would break textarea/code-editor native menus. Guardrail: D1 forbids any document-level contextmenu listener; review checkpoint = grep for `addEventListener('contextmenu'` must return zero.
- **Canvas keyboard gap**: canvas menus are pointer-only until a keyboard pass exists; mitigated by LayerTree parity for every layer action and Inspector parity for key actions (hold/edit-curve lives in Inspector already).
- **`duplicateKeyframe` time collisions**: two keys may share ms (store allows; sort stable). Acceptable — same result as dragging; no special handling.
- **Focus-steal surprise**: focusing the menu on mouse-open is deliberate; if owner objects, gate on `detail === 0`/keyboard detection later — isolated to the host's open routine.
- **Scroll-close vs scroll-follow**: closing on scroll is simplest and predictable; if owner wants follow-behavior later, `placeMenu` already isolates geometry so re-anchor-on-scroll is additive.
