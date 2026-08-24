# Plan: Rotation dial commits wonky fractional values (#64 follow-up)

**Date:** 2026-08-24 · **Branch:** `steward/plan-dial` · **Status:** plan only — no code changes
**Scope:** `src/components/Inspector.tsx` (RotationDial + SubScrub wiring), `src/utils/cssCompletions.ts` (rounding helpers), new tests.

---

## 1. Problem (owner feedback)

The rotation dial shipped in #64 works on desktop, but committed values are "wonky — sometimes two, sometimes three or four sub-zero [decimal] values" when the authored unit is not `deg`. Dragging also spams store writes.

## 2. Root cause (with refs)

All line numbers refer to `origin/main` @ `39054e1`.

### 2a. Commit-on-every-pointermove

- `Inspector.tsx:202-206` — `RotationDial.onPointerMove` calls `props.onChange!(degFromEvent(e))` on **every** move event.
- `Inspector.tsx:497-503` — SubScrub wires that straight into a store write:

  ```tsx
  <RotationDial
    deg={subDeg()!}
    onChange={(d) => {
      const unit = props.sub.unit || 'deg'
      commitSub(String(+fromDeg(d, unit).toFixed(2)), unit) // ← every move
    }}
  />
  ```

- `commitSub` (`Inspector.tsx:458-467`) → `commit()` (`Inspector.tsx:67-75`) → `updateKeyframe` (`store/index.ts:288-309`). Each call runs an immer `produce` over the whole doc and re-schedules autosave (`setDocWrapped`, `store/index.ts:101-108`; autosave itself is debounced 300 ms at `store/index.ts:65-79`, so persistence is OK — but reactive churn is per-move).

### 2b. Uniform `.toFixed(2)` in the _authored_ unit is lossy for rad/turn/grad

`degFromEvent` (`Inspector.tsx:179-187`) already emits **integer degrees**, so in `deg` units everything round-trips losslessly. The damage happens when converting back to non-degree units with two decimals:

| unit   | 50° becomes                      | back to degrees | error |
| ------ | -------------------------------- | --------------- | ----- |
| `turn` | `(50/360).toFixed(2)` = `"0.14"` | 50.4°           | 0.4°  |
| `rad`  | `(0.8727).toFixed(2)` = `"0.87"` | 49.84°          | 0.16° |
| `grad` | `"55.56"`                        | 50.004°         | ~0°   |

Worse, consecutive degree positions collapse to identical strings: in `turn`, every angle from 0–89° rounds to one of just `"0.00"`…`"0.25"` (1° ≈ 0.00278 turn). That is exactly the "sometimes two, sometimes three or four sub-zero values" report: dragging produces runs of `0.00`, `0.01`, `0.02` … that barely change and don't track the pointer.

### 2c. Mid-drag feedback loop

`RotationDial` renders purely from `props.deg` (no internal drag state; hand position derived at `Inspector.tsx:171-173`). During a drag:

move → commit quantized string → store write → `props.sub.value` changes → `subDeg()` re-parses it (`Inspector.tsx:452-456`) → `props.deg` snaps to the _quantized_ value, fighting the pointer. The needle visibly sticks/jumps in rad/turn/grad.

### 2d. What is already correct

- `degFromEvent` rounds to integers and wraps to [0, 360) (`Inspector.tsx:179-187`).
- Keyboard path already does ±1° / Shift ±15° with wrap (`Inspector.tsx:212-222`) — matches owner's ask.
- A second, read-only dial exists on number chips (`Inspector.tsx:810-812`) — unaffected.
- Precedent for rAF-throttled scrubbing lives in ValueChip (`Inspector.tsx:561-586`) via `scrubbedValue`/`clampToProperty` (`utils/scrub.ts`).

---

## 3. Prior art: what Chrome DevTools actually does

Sources (devtools-frontend, `front_end/ui/legacy/components/inline_editor/`):

- [`CSSAngleEditor.ts`](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/ui/legacy/components/inline_editor/CSSAngleEditor.ts) (contents verified against npm snapshot `chrome-devtools-frontend@1.0.1675430` via cdn.jsdelivr.net)
- [`CSSAngleUtils.ts`](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/ui/legacy/components/inline_editor/CSSAngleUtils.ts)
- [`CSSAngle.ts`](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/ui/legacy/components/inline_editor/CSSAngle.ts)

Findings:

1. **Drag granularity:** continuous — `updateAngleFromMousePosition(mouseX, mouseY, shouldSnapToMultipleOf15Degrees)` converts raw pointer radians to the authored unit with **no rounding during drag**; rounding is applied afterwards by `CSSAngle.updateAngle()`.
2. **Shift during drag = snap to multiples of 15°** (coarse, _not_ fine): `Math.round(radian / multipleInRadian) * multipleInRadian` where the multiple is 15 deg. DevTools has no "fine mode" modifier on the dial.
3. **Move throttling:** `mousemoveThrottler = new Common.Throttler.Throttler(16.67 /* 60fps */)` — updates coalesced to one per frame, but they are still continuous live updates while pressed (it's editing a live stylesheet).
4. **Keyboard / wheel:** shared helper `getNewAngleFromEvent(angle, event)` — base step **±1°** (`π/180` rad); **Shift multiplies by 10 → ±10°**. Wired to ArrowUp/ArrowDown (`CSSAngle.onKeydown`) and mouse wheel (`onEditorWheel`).
5. **Rounding at commit/display:** `roundAngleByUnit(angle)` — **deg & grad → nearest integer; rad → up to 4 decimals; turn → up to 2 decimals**. `CSSAngle.updateAngle()` applies this before dispatching `ValueChangedEvent`, so the string written back is always clean per-unit (`90grad`, `0.25turn`, `0.7854rad`).
6. Extras: wheel adjusts by same steps; Shift+click on the swatch cycles display unit (`getNextUnit`: deg→grad→rad→turn); Escape closes.

**Relevance deltas for KeyForge:** DevTools' clock is ~77 px, so sub-degree continuous dragging is meaningful there. KeyForge's dial is an 18×18 SVG with R=7 (`Inspector.tsx:168-170`) — one pixel of arc ≈ 8°, so continuous sub-degree control is pointless; integer-degree quantization (already implemented) plus per-unit clean formatting is the right adaptation. Note DevTools' own keyboard baseline is 1°.

**Shift semantics conflict inside KeyForge today:** `utils/scrub.ts:41-42` uses Shift = fine (÷10 effect) / Alt = coarse for linear scrubs, while arrow nudges use Shift = ×10 coarse (`Inspector.tsx:119`) and the dial keyboard uses Shift = 15° coarse (`Inspector.tsx:214`). DevTools is consistent: **Shift = coarse everywhere**. This plan adopts Shift-coarse for the dial; linear-scrub Shift-fine is out of scope but should be revisited later.

---

## 4. Proposed interaction model

1. **Default drag:** quantize to **1°** in degree space (already done by `degFromEvent`). Whole numbers guaranteed for `deg` and effectively for `grad` after formatting.
2. **Shift+drag:** snap to nearest **multiple of 15°** (DevTools behavior; replaces any "fine mode" idea).
3. **Keyboard:** ArrowUp/Down/Left/Right = **±1°**; Shift+Arrow = **±15°** (owner's spec; existing code already does this — keep, note DevTools uses ±10).
4. **Live preview vs commit:** during drag update **local component state only** (new `dragDeg` signal); render the hand from `dragDeg() ?? props.deg`. **Commit to store exactly once on `pointerup` / `lostpointercapture`.**
5. **Escape during drag:** cancel — restore pre-drag `props.deg`, discard preview (consistent with #64's Escape contract).
6. **Formatting on commit:** convert integer degrees → authored unit and format per-unit like DevTools' `roundAngleByUnit`: `deg`/`grad` → integers; `turn` → ≤2 dp; `rad` → ≤4 dp; trim trailing zeros. No more uniform `.toFixed(2)` in the authored unit. Round-trip error stays < 0.5° in all units (turn@2dp worst case 0.36°).
7. Optional parity items (cheap): wheel = ±1°, Shift+wheel = ±15°; keep existing `aria-valuenow`/`aria-valuetext`.

Sketch of the wiring fix (SubScrub):

```tsx
<RotationDial
  deg={dragDeg() ?? subDeg()!} // local preview wins mid-drag
  onPreview={(d) => setDragDeg(d)} // pointerdown/move — no store writes
  onCommit={(d) => {
    // pointerup / lostpointercapture / final key nudge
    const unit = props.sub.unit || 'deg'
    commitSub(formatAngle(d, unit), unit)
    setDragDeg(undefined)
  }}
/>
```

(`onKeyDown` nudges commit immediately as today, but through `formatAngle`.)

## 5. Write-throttling strategy

- **No store writes during drag.** The dial's live feedback comes from local state; the store sees exactly one mutation per gesture. This removes both the spam and the §2c feedback loop.
- If live keyframe-preview-through-store is ever wanted, mirror the ValueChip scrub rAF pattern (`Inspector.tsx:571-585`) rather than per-event writes — recommend against for now; local preview is strictly better here because the dial is its own preview surface.

## 6. Helpers and where they belong

- **Rounding/formatting helpers → `src/utils/cssCompletions.ts`**, next to `toDeg` (lines 137-150) and `fromDeg` (lines 157-170):
  - `formatAngle(deg: number, unit: string): string` — fromDeg + per-unit precision (`{ deg: 0, grad: 0, turn: 2, rad: 4 }`) + trailing-zero trim. Replaces `String(+fromDeg(d, unit).toFixed(2))` at `Inspector.tsx:501`.
  - Optionally export `ANGLE_UNIT_PRECISION` and a thin `snapToMultiple(deg, step)` used by Shift-drag.
  - Keep `toDeg`/`fromDeg` untouched (they're fine; the bug is precision policy at the call site).
- **Pointer→degree geometry → new pure module `src/utils/dialGeometry.ts`**: extract `degFromPoint(centerX, centerY, clientX, clientY)` (the atan2 + wrap math currently inline at `Inspector.tsx:179-187`) so it's unit-testable without DOM. (Geometry doesn't belong in cssCompletions.ts, whose header says "curated CSS completion lists".)

## 7. Test list (vitest, co-located `*.test.ts`)

New `src/utils/cssCompletions.test.ts` (file doesn't exist yet):

- `formatAngle` unit table: `formatAngle(90,'deg')==='90'`; `formatAngle(100,'grad')==='111'`; `formatAngle(90,'turn')==='0.25'`; `formatAngle(45,'rad')==='0.7854'`; trailing-zero trim (`180deg`→`'180'`, `0.5turn`→`'0.5'`).
- **Round-trip property:** for every integer d in 0..359 × each of `['deg','rad','turn','grad']`: `|toDeg(parseFloat(formatAngle(d,u)), u) − d| ≤ 0.5`.
- Float-noise regression: output never contains >precision decimals or artifacts like `0.30000000000000004`; never scientific notation.
- Wrap policy: `formatAngle(360,…)`≡`0`, negative input documented/handled.
- `snapToMultiple`: 355→360-wrap→`0`, 82→75, shift-off passthrough.

New `src/utils/dialGeometry.test.ts`:

- Cardinal points N/E/S/W → 0/90/180/270 (matches current 0°=up convention).
- Diagonals → 45/135/225/315; wrap across 359↔0 boundary.
- Degenerate center point (dx=dy=0) does not produce NaN (return previous angle or defined fallback).

Interaction-level (manual or jsdom, low priority):

- pointerdown+move without release → **zero** `updateKeyframe` calls; release → exactly one, formatted per §4.6.
- Escape mid-drag restores pre-drag value; Shift held mid-drag snaps hand to 15° multiples in preview.

## 8. Out of scope

- Linear-scrub modifier convention in `utils/scrub.ts` (Shift=fine there) — separate alignment decision.
- Enlarging the dial / popover-style big clock (DevTools' 77 px affordance).
- Unit cycling via Shift+click swatch (DevTools extra; nice later).

## 9. Acceptance criteria

1. Dragging in any of deg/rad/turn/grad yields committed strings that are integers (deg/grad) or DevTools-grade clean values (≤2dp turn, ≤4dp rad) — never `0.02`-style collapse runs.
2. One store write per gesture (plus immediate single writes per keyboard nudge).
3. Needle tracks the pointer during drag in all units (no quantization feedback).
4. Shift+drag snaps to 15°; arrows ±1°, Shift+arrows ±15°.
5. All new pure-function tests pass under `npm test`; `npm run typecheck` clean.
