import type { AnimationDocument } from '@/types'
import type { SnapIncrement } from './snap'
import { SNAP_VALUES } from './snap'
import { isValidOrigin } from './originMath'

// ── Document persistence (localStorage) ───────────────────────────────
// Pure functions, no Solid coupling, so they unit-test in node.

const STORAGE_KEY = 'keyforge:doc:v1'

export { STORAGE_KEY }

export interface PersistedDoc {
  version: 1
  savedAt: number
  doc: AnimationDocument
}

export function serializeDoc(doc: AnimationDocument): string {
  const payload: PersistedDoc = {
    version: 1,
    savedAt: Date.now(),
    doc,
  }
  return JSON.stringify(payload)
}

/** Returns the document if `raw` is a valid v1 payload, else null. */
export function deserializeDoc(raw: string | null): AnimationDocument | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return validatePersisted(parsed)
}

export function validatePersisted(parsed: unknown): AnimationDocument | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Partial<PersistedDoc>
  if (p.version !== 1) return null
  const d = p.doc as Partial<AnimationDocument> | undefined
  if (!d || typeof d !== 'object') return null
  if (typeof d.id !== 'string' || typeof d.name !== 'string') return null
  if (typeof d.duration !== 'number' || !Number.isFinite(d.duration) || d.duration <= 0) {
    return null
  }
  if (!Array.isArray(d.layers)) return null
  for (const layer of d.layers) {
    if (typeof layer?.id !== 'string' || typeof layer?.name !== 'string') return null
    // Collapse is optional view state: old payloads lack it (→ expanded),
    // and hand-edited storage may hold non-booleans. Coerce instead of
    // rejecting — a required field or version bump would wipe every
    // existing save back to emptyDefaultDoc().
    if (typeof layer.collapsed !== 'boolean') layer.collapsed = false
    // Additive hardening (transform-origin plan §2): a malformed structured
    // origin is DROPPED rather than rejected — same coercion philosophy as
    // collapsed above, so hand-edited storage never wipes the whole save.
    if (
      layer.element != null &&
      typeof layer.element === 'object' &&
      layer.element.origin !== undefined &&
      !isValidOrigin(layer.element.origin)
    ) {
      delete layer.element.origin
    }
    if (!Array.isArray(layer.tracks)) return null
    for (const track of layer.tracks) {
      if (typeof track?.id !== 'string' || typeof track?.property !== 'string') return null
      if (!Array.isArray(track.keyframes)) return null
      for (const kf of track.keyframes) {
        if (
          typeof kf?.id !== 'string' ||
          typeof kf?.time !== 'number' ||
          typeof kf?.value !== 'string' ||
          typeof kf?.easing !== 'string'
        ) {
          return null
        }
      }
    }
  }
  return p.doc as AnimationDocument
}

export function saveToStorage(raw: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, raw)
  } catch {
    // storage full or unavailable — persistence is best-effort
  }
}

export function loadFromStorage(): AnimationDocument | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  return deserializeDoc(raw)
}

export function clearStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// ── Onboarding flag ───────────────────────────────────────────────────
// Marks that the user has engaged with the app beyond the first-run
// empty state. While unset, an empty document means "brand-new user" and
// the guided EmptyState card is shown; once set, an empty document is a
// deliberate state and returning users aren't re-nagged with welcome copy.

export const ONBOARDING_KEY = 'keyforge:onboarded'

/** True when the onboarding flag has been persisted (best-effort read). */
export function hasOnboarded(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(ONBOARDING_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the onboarding flag. Idempotent; storage failures are ignored. */
export function markOnboarded(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(ONBOARDING_KEY, '1')
  } catch {
    // storage unavailable/full — onboarding may re-show, which is harmless
  }
}

export function clearOnboarded(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(ONBOARDING_KEY)
  } catch {
    // ignore
  }
}

// ── UI preferences ────────────────────────────────────────────────────
// Independent key from the document payload (no v1→v2 doc migration risk)
// with its own object-with-version shape so future toggles (gridline
// visibility, default zoom…) accrete without another key bump. Same
// best-effort, node-safe pattern as the onboarding flag above.

export const PREFS_KEY = 'keyforge:prefs:v1'

/** Explicit user theme choice — no OS auto-detection; schema stays v1. */
export type ThemeName = 'dark' | 'light'

export interface PersistedPrefs {
  version: 1
  snapIncrement: SnapIncrement
  /** Additive (v1): absent in pre-theme blobs; deserializePrefs defaults 'dark'. */
  theme?: ThemeName
  /**
   * Additive (v1): stage transform-origin markers (debug view). Absent or
   * garbage → absent (= false); only a literal `true` round-trips, keeping
   * default blobs clean — same philosophy as theme/snapIncrement coercion.
   */
  showOrigins?: boolean
  /**
   * Additive (v1): playback speed multiplier. Absent/garbage → 1.
   * Only the known ladder values round-trip.
   */
  playbackRate?: number
  /**
   * Additive (v1): work-area loop bookends (ms). Absent/garbage → absent
   * (defaults cover the full document at runtime).
   */
  workArea?: { start: number; end: number }
  /**
   * Additive (v1): stage Live-Editing mode — always-on transform-gizmo
   * outlines/handles. Absent or garbage → absent (= false); only a literal
   * `true` round-trips, keeping default blobs clean — same philosophy as
   * showOrigins coercion.
   */
  liveEdit?: boolean
}

function isSnapIncrement(v: unknown): v is SnapIncrement {
  if (v === 'off') return true
  return (
    typeof v === 'number' && Number.isInteger(v) && (SNAP_VALUES as readonly number[]).includes(v)
  )
}

export function serializePrefs(p: PersistedPrefs): string {
  return JSON.stringify(p)
}

/**
 * Returns validated prefs, or null when missing/corrupt.
 * Unknown snap values fall back to 'off' instead of rejecting the payload,
 * so a future rename can't strand the whole prefs blob.
 * `theme` is additive: blobs saved before it existed deserialize to 'dark',
 * and unknown values coerce to 'dark' — same philosophy as snapIncrement,
 * so a corrupt field can never invalidate the rest of the blob.
 * `showOrigins` is additive the same way: absent/garbage → absent (= false).
 * `liveEdit` (stage Live-Editing, Revision 1) follows that exact pattern too.
 */
export function deserializePrefs(raw: string | null): PersistedPrefs | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Partial<PersistedPrefs>
  if (p.version !== 1) return null
  const prefs: PersistedPrefs = {
    version: 1,
    snapIncrement: isSnapIncrement(p.snapIncrement) ? p.snapIncrement : 'off',
    theme: p.theme === 'light' ? 'light' : 'dark',
  }
  // Default false→absent: the key is only written when explicitly true, so
  // legacy blobs and cleared toggles stay byte-clean (no `"showOrigins":false`).
  if (p.showOrigins === true) prefs.showOrigins = true
  // Same additive coercion for Live-Editing: garbage → absent (= false).
  if (p.liveEdit === true) prefs.liveEdit = true
  // playbackRate: only ladder values round-trip; garbage → absent (= 1).
  if (typeof p.playbackRate === 'number' && [0.25, 0.5, 1, 2].includes(p.playbackRate)) {
    prefs.playbackRate = p.playbackRate
  }
  // workArea: finite, ordered, non-inverted pair only; garbage → absent.
  const wa = (p.workArea ?? {}) as Partial<{ start: number; end: number }>
  if (
    typeof wa.start === 'number' &&
    Number.isFinite(wa.start) &&
    typeof wa.end === 'number' &&
    Number.isFinite(wa.end) &&
    wa.end > wa.start
  ) {
    prefs.workArea = { start: wa.start, end: wa.end }
  }
  return prefs
}

/** Best-effort read; returns null without localStorage or on failure. */
export function loadPrefs(): PersistedPrefs | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return deserializePrefs(localStorage.getItem(PREFS_KEY))
  } catch {
    return null
  }
}

/** Persist the prefs. Best-effort — storage failures are ignored. */
export function savePrefs(p: PersistedPrefs): void {
  try {
    if (typeof localStorage === 'undefined') return
    // Merge over the last persisted blob so additive fields written by one
    // surface (e.g. the stage origins toggle) survive whole-blob rewrites
    // from another surface (snap picker, theme toggle). Explicit values in
    // `p` always win, including deliberate false/absent resets.
    const prev = loadPrefs()
    localStorage.setItem(PREFS_KEY, serializePrefs({ ...prev, ...p }))
  } catch {
    // storage unavailable/full — the setting just won't survive a reload
  }
}
