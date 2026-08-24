# Plan: Inspector transform editing — dead-end bug fix + add-flow improvement

Date: 2026-08-24 · Branch: `steward/plan-transform` · Repo: nicolasmn/keyforge
Scope: root-cause fix for "cannot re-add transform fns after deleting all of them", plus one tight add-friction improvement. No data-format changes.

---

## 1. Confirmed root cause (verified by scratch test)

**Mechanism — a value-classification dead end, not a store bug:**

1. Deleting the last fn in the stack UI calls `removeTransformFn(value, fi)`
   (`src/components/Inspector.tsx:734`), which splices and re-serializes via
   `serialize(stack)` → **returns the literal string `'none'` for an empty
   stack** (`src/utils/transformStack.ts:28-31, 62-67`). Confirmed:
   `removeTransformFn('translateY(40px)', 0) === 'none'`.
2. On next render, `tokenizeKeyframe` classifies the value purely from its
   text: `detectType(kf.value, 'value')` (`src/utils/tokenize.ts:110`,
   `:24-43`). `'none'` fails `TRANSFORM_FN_RE` (`tokenize.ts:27`) and every
   other branch, falling through to **`'string'`** (`tokenize.ts:42`).
   Note: `''` is unreachable through the UI — `updateKeyframe` rejects empty
   values (`src/store/index.ts:303`) — so `'none'` is the canonical dead state.
3. `ValueChip` renders the transform branch (sub-token chips + per-fn ✕/◀ +
   the **stack-picker (+)** button at `Inspector.tsx:756-766`) only when

   ```tsx
   <Show when={props.token.type === 'transform' && (props.token.subTokens?.length ?? 0) > 0}>
   ```

   (`Inspector.tsx:708`). With type `'string'` this gate is false, so the row
   falls through to the generic text chip branch (`Inspector.tsx:827-…`),
   which has **no add affordance at all**. Dead end.

**Hidden escape hatch (undiscoverable):** typing e.g. `scale(2)` into the
generic chip _does_ recover — `validate('string', …)` accepts any non-empty
string (`Inspector.tsx:87`) and the next tokenize reclassifies as transform.
But `completionsFor('string')` returns `[]` (`src/utils/cssCompletions.ts:173-190`)
and the chip's aria-label says "Edit string value none", so no user will find it.
The data layer is fine: `addTransformFn('none','scaleX') === 'scaleX(1)'`
(`transformStack.ts:54-59` handles `'none'`/empty input). Only the UI gate is broken.

**Failing case (scratch test, all assertions passed):**
`src/utils/scratch-deadend.test.ts` (untracked, kept out of the commit):

```
step 1  removeTransformFn('translateY(40px)', 0)            → 'none'
step 2  detectType('none', 'value')                          → 'string'
step 3  tokenizeKeyframe on track.property='transform',
        kf.value='none'  → token {type:'string'}, subTokens absent
        ⇒ ValueChip transform gate false ⇒ no (+) button     ← DEAD END
step 4  addTransformFn('none', 'scaleX')                     → 'scaleX(1)'
        (recovery possible in data; UI just never offers it)
step 5  #55 interplay — see §4 below
```

Same dead state is reachable via import: pasting CSS containing
`transform: none` stores keyframe value `'none'` (`src/utils/cssImport.ts:108-117`).

---

## 2. Fix design (recommended)

**A. Tokenizer — classify by property, not just value text** (`src/utils/tokenize.ts`):

- Widen the `track` param type from `Pick<Track,'id'|'keyframes'>` to include
  `'property'` (only caller is `Inspector.tsx:910-911`, already passing full `Track`).
- Classify before falling back to text detection:

```ts
const valueType: TokenType =
  track.property === 'transform' ? 'transform' : detectType(kf.value, 'value')
```

- Keep `detectType` itself unchanged and exported as-is; `parseTransformSubTokens('none')`
  already returns `[]`, so `subTokens` is simply an empty array. Scope note:
  deliberately **not** applied to individual-property tracks (`translate`/`rotate`/`scale`)
  whose values are plain numbers/angles.

**B. ValueChip — empty-state transform chip** (`src/components/Inspector.tsx:708`):

- Change the gate to `<Show when={props.token.type === 'transform'}>` (drop the
  sub-tokens-length condition).
- Inside, keep the `<For each={transformGroups()}>` (renders nothing when empty)
  and always render the (+) button. When `transformGroups().length === 0`, render
  a muted placeholder inside the chip shell, e.g. `<span class="kf-chip__empty">no functions</span>`,
  plus a title/hint: `"Add a function — or paste e.g. rotate(45deg)"` (surfaces the
  existing paste escape hatch for free). Per-fn ✕/◀ buttons disappear naturally
  since they live inside the group loop.
- No change needed to the picker or `addTransformFn` call site: it already
  commits correctly onto a `'none'` base. `open()`'s early-return for transform
  tokens (`Inspector.tsx:636`) keeps the empty-state chip non-editable as text,
  matching today's transform-chip contract; ensure the chip stays keyboard-reachable
  (focusable span, (+) button focusable).

Self-healing bonus: documents previously saved with `'none'` transform KFs render
correctly after this fix; imported `transform: none` stops are covered too.

---

## 3. Add-flow friction evaluation (owner feedback #1)

Current flow: reveal chip (requires ≥1 fn — the bug) → click (+) → flat menu of
15 fn names → click one → inert default args (`scale(1)`, `translateX(0px)` give
no visual feedback) → tap each arg chip to edit.

Alternatives considered:

| Option                                                       | Effect                                                                      | Scope                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------- |
| **A. Always-visible inline "+" + empty-state chip**          | Fixes dead end AND cuts one step; add-from-zero becomes: click + → pick fn. | Minimal — required by the fix anyway      |
| B. Preset stacks ("slide-up", "pop", "spin") atop the picker | One click = meaningful multi-fn stack with visible defaults                 | Moderate (preset table + picker section)  |
| C. Paste-a-transform shorthand                               | Already works today (generic chip accepts any string); just undiscoverable  | ~Free as hint copy inside A's empty state |

**Primary recommendation: A**, folding C's hint into the empty-state copy.
It resolves both owner complaints with one mechanism and zero new concepts.
B is a good fast-follow but adds surface area; defer unless asked.

---

## 4. Regression risks

- **Roundtrip/export of `'none'`:** standalone `transform: none` keyframes are
  valid CSS; export path untouched. The real hazard is **#55 `mergeTransformTracks`
  interplay**: merged values are built as sampled stacks `.filter(Boolean).join(' ')`
  (`src/utils/spatialCompose.ts:160-166`), but `'none'` is truthy, so scratch step 5
  produced **`"translateX(10px) none"` — invalid CSS that makes browsers drop the
  whole declaration**. Pre-existing (not caused by fix A), but fix A makes such
  tracks more prominent. Recommended hardening under the #55 umbrella: filter
  literal `'none'` samples before joining, fall back to `'none'` if everything filters
  out. Also pin current hold semantics: `lerpStacks` returns `null` for empty stacks
  (`spatialCompose.ts:56-59`), so none↔fn boundaries step/hold rather than lerp —
  acceptable, document it.
- **Classification coupling:** `detectType` export has no other production consumers;
  property-keyed override is confined to `tokenizeKeyframe`. Existing tests contain no
  `'none'` assertions (grepped tokenize/spatialCompose/export/roundtrip suites), so low
  regression surface.
- **Individual-property quirk (out of scope, do not touch):**
  `DEFAULT_FIRST_VALUE.translate = 'translate(0px, 0px)'` (`store/index.ts:132-136`)
  matches `TRANSFORM_FN_RE`, so translate-track first KFs already classify as
  transform-type today. Fix A keys strictly on `track.property === 'transform'` and
  must not widen to those tracks.
- **UI:** generic-branch gate (`Inspector.tsx:827`) excludes `type === 'transform'`;
  post-fix, `'none'` rows render only via the transform branch — verify no double
  render and that scrub helpers (`startScrub` bails on NaN) stay harmless.

## 5. Test list

Tokenizer (`tokenizeLayer.test.ts` / `transformStack.test.ts`):

1. Transform track, `kf.value='none'` → token type `'transform'`, `subTokens` `[]`.
2. Defensive: transform track, `kf.value=''` → same (store rejects empties, but tokenizer shouldn't crash).
3. Non-transform tracks unchanged: opacity `'42'`→number, colors→color; `translate`/`rotate` tracks still classify by value text.
4. `detectType('none','value')` still `'string'` (pin, so behavior is intentional).
5. `removeTransformFn` last-fn → `'none'`; `addTransformFn('none', …)` recovers; `moveTransformFn` bounds on single-fn stack.

Component behavior (no component test infra in repo — extract pure gate helper if we want it unit-tested, else manual QA checklist): 6. Delete last fn → chip remains transform-shaped with (+); picker opens from empty state; added fn appears; Escape closes picker; chip keyboard-focusable; aria-labels say "no functions" not "string". 7. Undo (single-write path) restores prior stack.

#55 follow-up (separate commit if taken): 8. `mergeTransformTracks` drops `'none'` samples from joins; all-`'none'` group → `'none'`. 9. Pin hold-across-none-boundary in `sampleTrackValue`.

---

_Scratch verification: `src/utils/scratch-deadend.test.ts` in worktree `/root/workspace/kf-plan-transform` (untracked; delete after implementation lands its permanent equivalents)._
