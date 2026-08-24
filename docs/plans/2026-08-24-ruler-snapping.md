# Ruler: triangle playhead revert, snapping, lane gridlines, adaptive label density

**Date:** 2026-08-24
**Scope:** `src/components/Timeline.tsx`, new `src/utils/snap.ts`, new `src/utils/rulerScale.ts`, `src/store/index.ts`, `src/utils/persistence.ts`
**Trigger:** Owner feedback on the #62 timeline ship (triangle head preference; snapping; vertical gridlines; adaptive ruler density).
**Status:** Plan only — no implementation in this branch.

---

## 1. Playhead: revert visual head to triangle (keep everything else from #62)

Owner prefers the pre-#62 **triangle** head. Keep: scrub glow (`shadowBlur`), time
bubble chip, and the full-height grabbable column (`PLAYHEAD_HIT = 6`, `nearPlayhead`,
`ew-resize` cursor). Only the drawn cap changes.

### Diff sketch — `src/components/Timeline.tsx`

Delete the rounded-cap block (current lines ~221–230):

```ts
// REMOVE:
const capR = 4 * dpr
const capY = Math.min(10 * dpr, (HEADER_HEIGHT / 2) * dpr)
ctx.beginPath()
ctx.arc(ph, capY, capR, 0, Math.PI * 2)
ctx.fillStyle = colorAccent
ctx.fill()
ctx.lineWidth = 1.5 * dpr
ctx.strokeStyle = colorBg
ctx.stroke()
```

Replace with the exact pre-#62 geometry (`git show 3831133~1:src/components/Timeline.tsx`,
lines 163–167), plus a 1px background-colored outline for crispness against the
ruler border — same convention the keyframe diamonds already use:

```ts
// ADD: triangle head pointing into the timeline (owner preference; reverts
// #62's dot/cap while keeping glow + time bubble + grab column).
ctx.beginPath()
ctx.moveTo(ph - 6 * dpr, 0)
ctx.lineTo(ph + 6 * dpr, 0)
ctx.lineTo(ph, 10 * dpr)
ctx.fillStyle = colorAccent
ctx.fill()
ctx.lineWidth = 1 * dpr
ctx.strokeStyle = colorBg
ctx.stroke()
```

Notes:

- The hairline body (`fillRect(ph, 0, 2*dpr, height)` with/without glow) is untouched.
- The apex lands at y=10px like the old version and like the old `capY` clamp, so it
  stays inside `HEADER_HEIGHT` even if that constant shrinks.
- Decision point: pure revert would omit the `colorBg` stroke; recommend keeping it so
  the triangle reads cleanly over the solid header band. One line either way.
- Update the comment above the block ("rounded grabbable cap") to describe the triangle.

---

## 2. Snapping

### 2a. Pure function — new file `src/utils/snap.ts`

Follows the repo's "pure math in utils, canvas stays dumb" pattern (`scrub.ts`, `interpolate.ts`).

```ts
export type SnapIncrement = 'off' | 1 | 10 | 100 | 500 | 1000

export const SNAP_VALUES: readonly number[] = [1, 10, 100, 500, 1000]

export function snapTime(t: number, increment: SnapIncrement, max?: number): number {
  if (increment === 'off' || !Number.isFinite(t)) return t
  const snapped = Math.round(t / increment) * increment // integer inc ⇒ exact result
  const clamped = Math.max(0, Math.min(max ?? Infinity, snapped))
  return clamped
}
```

Design notes:

- `Math.round` half-up at exact midpoints (`1250 @ inc=500 → 1500`) — document it; don't chase banker's rounding.
- Integer increments keep results FP-exact (products of integers within ms ranges), so no epsilon fixup needed. The wheel path can still feed fractional `t`; snapping normalizes it.
- Clamping to `max` (the doc duration) happens here so every call site gets one consistent contract instead of re-implementing `Math.min/max`.
- `'off'` short-circuits, including the clamp — call sites must not rely on snapTime for clamping when off (they already clamp via `xToTime`).

### 2b. Store signal — `src/store/index.ts`

Next to the playhead signals (~line 118):

```ts
export const [snapIncrement, setSnapIncrement] = createSignal<SnapIncrement>(
  loadPrefs()?.snapIncrement ?? 'off',
)
```

Import from utils to avoid a circular dep: store imports persistence; persistence
imports the type from `snap.ts` (types only) — no cycle since `snap.ts` imports nothing.

### 2c. Call-site wiring — `src/components/Timeline.tsx`

All user-driven gestures snap; the rAF playback loop must **not**.

| Site                                           | Line     | Change                                                                                                                                                              |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ruler pointer-down jump                        | ~421     | `setPlayhead(snapTime(xToTime(x, w), snapIncrement(), doc.duration))`                                                                                               |
| Lanes empty-area click jump                    | ~441     | same wrap                                                                                                                                                           |
| Scrub move                                     | ~457     | same wrap                                                                                                                                                           |
| Wheel nudge                                    | ~507     | `setPlayhead((prev) => snapTime(prev + e.deltaX * msPerPx, snapIncrement(), doc.duration))`                                                                         |
| Keyframe drag time                             | ~461–463 | `time: snapTime(Math.round(xToTime(x, w)), snapIncrement(), doc.duration)` — existing `Math.round` becomes redundant when inc≥1 but keep it as the `'off'` behavior |
| Duration handle `applyDurationFromX`           | ~58      | leave as-is (already quantized to 50ms); note as possible follow-up                                                                                                 |
| `promptDuration` / Playback / EmptyState jumps | —        | leave unsnapped: they are explicit numeric inputs or resets, not gestures                                                                                           |

Wheel hysteresis: snapping `prev + delta` each event means small trackpad deltas hold at a
detent until accumulated movement crosses inc/2 — this is the intended stepped feel, not a bug.
If it feels sticky at inc=1000, an un-snapped accumulator ref can be added later.

### 2d. UI control — recommendation: `<select>` in the playback cluster

Owner floated ruler-right-click vs playback cluster, "keep minimal".

**Recommended: native `<select>` appended to `Playback.tsx`.**

- ~15 lines: `<select value={snapIncrement()} onChange={e => { setSnapIncrement(v); savePrefs(...) }}>` labeled `Snap:` with options `Off / 1ms / 10ms / 0.1s / 0.5s / 1s`.
- Always visible ⇒ discoverable (right-click-on-canvas menus never get found).
- Native select gets keyboard/screenreader support free, matching the accessibility bar set in #57/#58.
- Cluster currently holds play/stop/loop/duration — one more compact control fits without crowding on desktop; verify at narrow widths (MobileTabs layout).

Rejected alternative (documented): `contextmenu` handler on the canvas restricted to
`y < HEADER_HEIGHT`, rendering an absolutely-positioned listbox div as a sibling of the
canvas. Costs a local open/close state machine, Escape/outside-click handling, focus trap,
and positioning math (~80 lines) for zero discoverability.

Persistence of the setting change goes through `savePrefs()` on change (see §2e);
restore happens once at store init (§2b). No autosave coupling — prefs save immediately,
mirroring `markOnboarded`.

### 2e. Settings persistence — `src/utils/persistence.ts`

New independent key, same pattern as `ONBOARDING_KEY` (doc payload untouched, no v1→v2 migration risk):

```ts
import type { SnapIncrement } from './snap'

export const PREFS_KEY = 'keyforge:prefs:v1'

export interface PersistedPrefs {
  version: 1
  snapIncrement: SnapIncrement
}

export function serializePrefs(p: PersistedPrefs): string {
  return JSON.stringify(p)
}

/** Returns validated prefs, or null when missing/corrupt. Unknown snap values fall back to 'off'. */
export function deserializePrefs(raw: string | null): PersistedPrefs | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    if (p?.version !== 1) return null
    return {
      version: 1,
      snapIncrement: SNAP_VALUES.includes(p.snapIncrement) ? p.snapIncrement : 'off',
    }
  } catch {
    return null
  }
}

export function loadPrefs(): PersistedPrefs | null {
  try {
    return deserializePrefs(localStorage.getItem(PREFS_KEY))
  } catch {
    return null
  }
}

export function savePrefs(p: PersistedPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, serializePrefs(p))
  } catch {
    /* best-effort */
  }
}
```

Shape rationale: object-with-version (not a bare scalar like the onboarding flag) because
prefs will accrete future toggles (gridline visibility, default zoom) without another key bump.

### 2f. Unit tests

`src/utils/snap.test.ts`:

1. `'off'` returns input unchanged, including fractional input and out-of-range input.
2. Rounds to nearest increment: `(1234, 100) → 1200`, `(1260, 100) → 1300`.
3. Half-up midpoint documented: `(1250, 500) → 1500`, `(249.9, 500) → 0`, `(250, 500) → 500`.
4. Negative input clamps to 0.
5. Input > `max` clamps to `max`: `(9999, 100, 2000) → 2000`; exactly-`max` input passes through.
6. No `max` argument ⇒ no upper clamp.
7. `inc=1` always returns an integer.
8. FP robustness: `(999.9999999, 500) === 1000`, `(299.9999999, 100) === 300`.
9. Non-finite guard: `(NaN, 100)` returns NaN unchanged; `(Infinity, 100)` unchanged.
10. Every `SNAP_VALUES` entry divides evenly into itself: `snapTime(v, v) === v`.

`src/utils/persistence.test.ts` (additions): 11. `deserializePrefs(null)` / garbage JSON / wrong `version` → `null`. 12. Unknown `snapIncrement` value (e.g. `42`) coerces to `'off'`. 13. Roundtrip `serializePrefs` → `deserializePrefs` preserves value. 14. `loadPrefs/savePrefs` tolerate a throwing `localStorage` (mock).

`src/utils/rulerScale.test.ts` (see §4):
15–18 listed there.

---

## 3. Vertical gridlines through the lanes area

Today major ticks draw only inside the header: `ctx.fillRect(x*dpr, 0, 1, HEADER_HEIGHT*dpr)` (Timeline.tsx ~106).

### Ordering problem (why this isn't a one-line change)

Track rows paint **opaque** backgrounds (`hsl(220 12% 15%)` / `colorBg`) across the full
canvas width _after_ the ruler pass. Gridlines drawn during the ruler pass get erased.

### Recommended approach: per-row segment, drawn after row bg, before diamonds

Inside the existing rows `forEach`, after painting the row background/separator/label and
**before** the keyframes loop, draw the grid segments clipped to that row:

```ts
// Vertical gridlines: majors extend through the lanes, under diamonds.
const gridBottom = HEADER_HEIGHT + totalTrackRows() * TRACK_HEIGHT
ctx.save()
ctx.globalAlpha = 0.35
ctx.fillStyle = colorBorder
for (let i = 0; i <= tickCount; i++) {
  const x = timeToX((doc.duration / tickCount) * i, width / dpr)
  ctx.fillRect(x * dpr, (HEADER_HEIGHT + row * TRACK_HEIGHT) * dpr, 1 * dpr, TRACK_HEIGHT * dpr)
}
ctx.restore()
```

Why per-row segments rather than one post-rows pass:

- Preserves z-order with a minimal diff: row bg < gridline < diamond. A single pass after all rows would overpaint diamonds; splitting rows into two loops is a bigger refactor for identical pixels.
- Cost is trivial (majors × rows fillRects, ≤ a few hundred).

### Styling recommendation (subtle)

- **Width:** 1 CSS px (`1 * dpr` device px) — consistent with existing ticks.
- **Color:** reuse `--color-border` with `globalAlpha ≈ 0.35` (don't hardcode rgba; CSS var format varies by theme, and alpha-compositing works regardless). Tune 0.3–0.4 visually on both themes before shipping.
- **Majors only** through the lanes; minors stay 4px header nubs (§4 may revisit).
- Skip drawing where x < LABEL_WIDTH (inherent: first major sits at the label gutter edge) and nothing special needed at the right edge (duration label/handle zone unaffected).
- Extend to the scrollable content height, not just the visible panel: use `totalTrackRows() * TRACK_HEIGHT` bottom (matches `resize()`'s content sizing), so scrolled tracks stay gridded.

---

## 4. Adaptive label-step density

Goal: fixed-width windows show today's look (≈ duration/10 majors); wide windows reveal
finer granularity down to every millisecond, with no label collisions.

### New pure module — `src/utils/rulerScale.ts`

Canvas-independent (inject the measurer) so it unit-tests in node:

```ts
/** Nice-number steps: 1-2-5 decades, ms units, capped at duration/2. */
export function candidateSteps(duration: number): number[] {
  const steps: number[] = []
  for (let d = 1; d <= duration; d *= 10) {
    for (const m of [1, 2, 5]) {
      const s = d * m
      if (s <= duration / 2 && s >= 1) steps.push(Math.round(s))
    }
  }
  return steps.reverse() // coarse → fine
}

/**
 * Smallest nice step whose labels cannot collide.
 * measure(label) returns rendered px width at the current font.
 */
export function chooseLabelStep(
  duration: number,
  laneWidthPx: number,
  gapPx: number,          // recommend 14
  minStepPx = 6,          // ticks closer than this look like noise
  measure: (label: string) => number,
): number {
  const baseline = duration / 10            // today's density floor
  const widestAt = (s: number) => measure(formatTick(duration, s))
  let best = baseline
  for (const s of candidateSteps(duration)) {
    const requiredPx = widestAt(s) + gapPx
    const slots = Math.floor(laneWidthPx / requiredPx)
    const intervals = Math.floor(duration / s) + 1
    const spacingOk = s >= Math.min(baseline, ...) /* see test 17 */
    if (intervals <= slots && spacingOk) best = Math.min(best, s)
    else break                              // coarser than this failed? no — see below
  }
  return best
}
```

Concrete algorithm (final form for implementation):

1. Start `best = duration / 10` (today's behavior — never coarser than shipped).
2. Iterate candidates coarse → fine. For each step `s`:
   - Format the representative label at `t = duration` (widest realistic string).
   - `requiredPx = measureText(label).width + GAP_PX` (`GAP_PX = 12`).
   - `maxLabels = floor(laneWidthPx / requiredPx)`.
   - Accept `s` iff `floor(duration / s) + 1 <= maxLabels` **and** `s * pxPerMs >= MINOR_TICK_SPACING_PX`-style floor (`>= 6px` between ticks) **and** `s >= 1` (never finer than 1 ms).
   - Keep the finest accepted step; stop iterating once a candidate fails (steps are monotone in strictness).
3. Font caveat: `measure` must run with the ruler font already set (`11px monospace` × dpr) — call it inside `draw()` after `ctx.font` assignment, passing `(label) => ctx.measureText(label).width / dpr`.

Label formatting (`formatTick(t, step)`): switch unit by magnitude —
`t < 1000 ? `${Math.round(t)}ms` : `${(t / 1000).toFixed(step < 10 ? 3 : step < 100 ? 2 : step < 1000 ? 1 : 1)}s``.
Trailing-zero trim optional; keep monospace font so widths are predictable.

Majors then tick at multiples of `step` from 0 up to `floor(duration / step) * step`. Note:
the last major may land _before_ `duration` for non-divisible steps — acceptable; the
duration readout at the right edge (`${doc.duration}ms`, already bold/primary) still marks the end. Today's divisible case renders identically.

Minors: replace the fixed `MINOR_TICKS=50` with `minorStep = labelStep / 5`, skipping minors that would sit < 4px apart (`if (minorStep * pxPerMs < 4) minorStep = labelStep / 2`). Keeps the ruler readable at both extremes.

Ghost/time-chip formatting is untouched.

Unit tests (`src/utils/rulerScale.test.ts`): 15. Narrow lane (labels would collide at baseline) returns exactly `duration / 10` — today's output. 16. Wide lane returns a finer nice step (assert `result < duration / 10 && result ∈ candidates`). 17. Collision guarantee with a fake measurer: chosen step satisfies `intervals * (width+gap) <= laneWidth`. 18. Monotonicity: widening the lane never coarsens the step. 19. Never finer than 1 ms even on absurdly wide lanes; never coarser than `duration / 10`. 20. `candidateSteps` contains 1, 2, 5, 10… pattern and caps at `duration / 2`.

Synergy (noting only): once adaptive steps exist, a future "snap follows label step" mode falls out for free — out of scope here.

---

## Risks & mitigations

| Risk                                                                   | Mitigation                                                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default snap changes existing feel                                     | Ship default `'off'`; owner can flip the persisted pref. All gesture sites wrapped uniformly so enabling later is a one-value change.               |
| Wheel-snap stickiness at large increments                              | Expected detent behavior; if it feels wrong at 1s, add an un-snapped accumulator ref (isolated to `onWheel`).                                       |
| Gridline contrast wrong on light/dark themes                           | Use `--color-border` + `globalAlpha` 0.35; eyeball both themes; single constant to tune.                                                            |
| Opaque row backgrounds erasing gridlines                               | Per-row draw ordering specified in §3; regression is visually obvious.                                                                              |
| `measureText` called with wrong font (wrong widths → collisions)       | Measure inside `draw()` after font assignment; inject measurer into pure fn; test 17 guards collision math.                                         |
| Last major tick not at `duration` for arbitrary steps                  | Accepted deviation; right-edge duration readout unaffected. Documented in §4.                                                                       |
| Keyframes collapsing onto t=0 when dragging with coarse snap (e.g. 1s) | Same behavior as any DAW; sort in `updateKeyframe` already handles ties. No guard needed.                                                           |
| Prefs corruption / stale schema                                        | Independent `keyforge:prefs:v1` key; validator falls back to `'off'`; doc payload untouched (no migration).                                         |
| Playback loop accidentally snapping                                    | Snapping lives only in Timeline gesture handlers; Preview's rAF `setPlayhead(next)` untouched. Add a code-comment warning at the signal definition. |
| Triangle stroke vs pure revert ambiguity                               | Flagged as decision point in §1; one-line difference.                                                                                               |

## Suggested implementation order (single PR is fine)

1. `snap.ts` + tests (no UI risk).
2. Persistence + store signal + Playback select.
3. Timeline wiring (triangle revert can ride along or split separately).
4. Gridlines (visual tuning pass).
5. `rulerScale.ts` + adaptive majors/minors (largest surface; behind green tests).
