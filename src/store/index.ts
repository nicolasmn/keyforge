import { createStore, produce, reconcile } from 'solid-js/store'
import { createSignal } from 'solid-js'
import type { AnimationDocument, Layer, Track, Keyframe, AnimatableProperty } from '@/types'
import { nanoid } from '@/utils/nanoid'
import {
  serializeDoc,
  saveToStorage,
  loadFromStorage,
  hasOnboarded,
  markOnboarded,
  loadPrefs,
  savePrefs,
} from '@/utils/persistence'
import type { SnapIncrement } from '@/utils/snap'
import type { ThemeName } from '@/utils/persistence'
import { interpolatedValueAt } from '@/utils/interpolate'
import { createStarterBoxLayer } from '@/utils/sampleDoc'

// ── Default document ──────────────────────────────────────────────────
/**
 * A 0-layer "Untitled" document.
 *
 * True first run seeds this EMPTY doc so the guided EmptyState card in the
 * preview actually fires for new users (audit F21). The pre-built Box
 * layer that used to be seeded here now lives behind "Add your first
 * layer" → addStarterLayer() — a great result, just not an opening state.
 *
 * Returning users with a deliberately emptied doc are restored from their
 * autosave and gated by the `keyforge:onboarded` flag instead of being
 * shown welcome copy again.
 */
function emptyDefaultDoc(): AnimationDocument {
  return {
    id: nanoid(),
    name: 'Untitled',
    duration: 2000,
    layers: [],
  }
}

// ── Store ─────────────────────────────────────────────────────────────
// Restore a previously worked-on document if one was autosaved; otherwise
// start from the empty first-run document (see emptyDefaultDoc above).
const restoredDoc = loadFromStorage()
const [doc, setDocRaw] = createStore<AnimationDocument>(restoredDoc ?? emptyDefaultDoc())
export { doc }

// ── Onboarding state ──────────────────────────────────────────────────
/** True once the user has engaged beyond the first-run empty state. */
const [onboarded, setOnboarded] = createSignal(hasOnboarded())
export { onboarded }

/**
 * Mark onboarding complete once the document has content — every write
 * path funnels through scheduleSave/replaceDoc, so this single check
 * covers layer adds, sample loads and imports alike.
 */
function syncOnboardingFlag() {
  if (!onboarded() && doc.layers.length > 0) {
    markOnboarded()
    setOnboarded(true)
  }
}

// ── Autosave ───────────────────────────────────────────────────────────
// Every mutation in this module goes through setDoc, so the save hook
// lives there (deep store subscriptions would need a reactive root; this
// is complete because setDoc is the only write path).
let saveTimer: ReturnType<typeof setTimeout> | undefined
let savePending = false
const AUTOSAVE_DEBOUNCE_MS = 300

function flushSave() {
  serializeAndSave(doc)
  savePending = false
}

function scheduleSave() {
  syncOnboardingFlag()
  savePending = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS)
}

/** Replace the whole document (import / sample load / reset) and persist now. */
export function replaceDoc(next: AnimationDocument) {
  setDocRaw(reconcile(next))
  syncOnboardingFlag()
  flushSave()
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (savePending) flushSave()
  })
}

function serializeAndSave(d: AnimationDocument) {
  saveToStorage(serializeDoc(d))
}

/**
 * The single write path for document mutations. Wraps the raw store setter
 * so autosave scheduling can't be bypassed by any mutation.
 */
function setDocWrapped(
  updater: AnimationDocument | ((prev: AnimationDocument) => AnimationDocument),
): void
function setDocWrapped<K extends keyof AnimationDocument>(key: K, value: AnimationDocument[K]): void
function setDocWrapped(...args: unknown[]): void {
  ;(setDocRaw as unknown as (...a: unknown[]) => void)(...args)
  scheduleSave()
}
const setDoc = setDocWrapped
export { setDoc }

// ── Selection ──────────────────────────────────────────────────────────
// Starts null: the first-run seed document is empty (audit F21), so there
// is nothing to pre-select.
export const [selectedLayerId, setSelectedLayerId] = createSignal<string | null>(null)
export const [selectedKeyframeId, setSelectedKeyframeId] = createSignal<string | null>(null)

// ── Playhead ────────────────────────────────────────────────────────────
export const [playhead, setPlayhead] = createSignal(0) // ms
export const [playing, setPlaying] = createSignal(false)
export const [loop, setLoop] = createSignal(true)

// ── Snapping preference ────────────────────────────────────────────────
/**
 * Increment user-driven gestures (scrub, wheel nudge, keyframe drag)
 * quantize to. Restored from persisted prefs once at module init.
 *
 * ⚠️ Preview's rAF playback loop must NEVER read this — animation stays
 * smooth and unsnapped regardless of the preference. Snapping lives only
 * in Timeline's gesture handlers.
 */
export const [snapIncrement, setSnapIncrement] = createSignal<SnapIncrement>(
  loadPrefs()?.snapIncrement ?? 'off',
)

// ── Theme preference ───────────────────────────────────────────────────
/**
 * Explicit user theme ('dark' | 'light'). Restored from the same prefs
 * blob as snapping; index.html's inline pre-paint script has already set
 * `data-theme` on <html> by the time this module runs — mirror it here so
 * the DOM attribute and this signal can never diverge (the script and
 * loadPrefs read the same storage key).
 */
const initialTheme: ThemeName = loadPrefs()?.theme ?? 'dark'
export const [theme, setTheme] = createSignal<ThemeName>(initialTheme)
if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = initialTheme
}

/** Flip dark ↔ light, update <html data-theme>, persist. */
export function toggleTheme() {
  const next: ThemeName = theme() === 'dark' ? 'light' : 'dark'
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = next
  }
  setTheme(next)
  savePrefs({ version: 1, snapIncrement: snapIncrement(), theme: next })
}

// ── Mutations ──────────────────────────────────────────────────────────

/**
 * Sensible starting values per property, so the FIRST keyframe on a fresh
 * track is something a user would actually want to animate from.
 */
export const DEFAULT_FIRST_VALUE: Record<AnimatableProperty, string> = {
  opacity: '0',
  transform: 'translateY(40px)',
  'background-color': 'hsl(264 80% 68%)',
  color: 'hsl(220 10% 88%)',
  'border-radius': '0px',
  width: '80px',
  height: '80px',
  scale: '1',
  translate: 'translate(0px, 0px)',
  // Bare angle — the individual `rotate` property's own syntax. Function
  // form (`rotate(0deg)`) is transform-track syntax and emits invalid CSS
  // on a rotate track (browsers drop the declaration → animation no-ops).
  rotate: '0deg',
}
export function addLayer() {
  const id = nanoid()
  setDoc(
    produce((d) => {
      d.layers.push({
        id,
        name: `Layer ${d.layers.length + 1}`,
        visible: true,
        collapsed: false,
        element: {
          tag: 'div',
          text: '',
          initialCss: 'width:60px;height:60px;background-color:hsl(200 80% 60%);border-radius:4px;',
        },
        tracks: [],
      })
    }),
  )
  setSelectedLayerId(id)
}

/**
 * Add the pre-built starter "Box" layer (opacity + transform tracks ready
 * to scrub) — what "Add your first layer" creates. This is the content the
 * store used to seed on every fresh visit; it now lives behind this
 * mutation so true first run can show the guided EmptyState instead (F21).
 */
export function addStarterLayer() {
  const layer = createStarterBoxLayer()
  setDoc(
    produce((d) => {
      d.layers.push(layer)
    }),
  )
  setSelectedLayerId(layer.id)
}

export function removeLayer(layerId: string) {
  setDoc(
    produce((d) => {
      d.layers = d.layers.filter((l) => l.id !== layerId)
    }),
  )
  if (selectedLayerId() === layerId) setSelectedLayerId(doc.layers[0]?.id ?? null)
}

export function renameLayer(layerId: string, name: string) {
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (layer) layer.name = name.trim() || layer.name
    }),
  )
}

/** Move layer at `fromIndex` to `toIndex`. */
export function reorderLayer(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return
  setDoc(
    produce((d) => {
      const [layer] = d.layers.splice(fromIndex, 1)
      d.layers.splice(toIndex, 0, layer)
    }),
  )
}

export function setLayerVisibility(layerId: string, visible: boolean) {
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (layer) layer.visible = visible
    }),
  )
}

/**
 * Collapse state for the timeline: a collapsed layer renders ONE summary
 * row instead of one row per track. View state (like `visible`), so it
 * rides the normal setDoc autosave path.
 */
export function setLayerCollapsed(layerId: string, collapsed: boolean) {
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (layer) layer.collapsed = collapsed
    }),
  )
}

export function toggleLayerCollapsed(layerId: string) {
  const current = doc.layers.find((l) => l.id === layerId)?.collapsed === true
  setLayerCollapsed(layerId, !current)
}

/**
 * Add a property track to a layer — ONE track per property, ever.
 *
 * Two animations animating the same CSS property cannot compose: per
 * css-animations-1 the animation later in the animation-name list overrides
 * the other entirely ("last one wins"), so a duplicate transform/opacity/…
 * track would silently kill the first. Requesting a property that already
 * has a track is a no-op returning the existing track's id.
 */
export function addTrack(layerId: string, property: AnimatableProperty): string | null {
  const existing = doc.layers
    .find((l) => l.id === layerId)
    ?.tracks.find((t) => t.property === property)
  if (existing) return existing.id

  const id = nanoid()
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (!layer) return
      // Re-check inside produce in case a concurrent mutation slipped in.
      const dup = layer.tracks.find((t) => t.property === property)
      if (dup) return
      layer.tracks.push({ id, property, keyframes: [] })
    }),
  )
  return id
}

/** Remove an entire property track (and all its keyframes) from a layer. */
export function removeTrack(layerId: string, trackId: string) {
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (!layer) return
      layer.tracks = layer.tracks.filter((t) => t.id !== trackId)
    }),
  )
}

export function addKeyframe(layerId: string, trackId: string, kf: Omit<Keyframe, 'id'>) {
  setDoc(
    produce((d) => {
      const track = d.layers.find((l) => l.id === layerId)?.tracks.find((t) => t.id === trackId)
      if (!track) return
      // Smart defaults: an empty value means "pick something useful".
      // 1. Playhead strictly between two keyframes → capture the
      //    interpolated pose the preview shows right now (pose-to-pose).
      // 2. First KF on a track → per-property starting value.
      // 3. Otherwise → inherit the previous keyframe's value.
      if (kf.value === '') {
        const interpolated = interpolatedValueAt(track, kf.time)
        const sorted = [...track.keyframes].sort((a, b) => a.time - b.time)
        const isBetween =
          sorted.length > 0 && kf.time > sorted[0].time && kf.time < sorted[sorted.length - 1].time
        if (isBetween && interpolated !== null) {
          kf.value = interpolated
        } else if (track.keyframes.length === 0) {
          kf.value = DEFAULT_FIRST_VALUE[track.property] ?? '0'
        } else {
          const prev = sorted[sorted.length - 1]
          kf.value = prev?.value ?? '0'
        }
      }
      track.keyframes.push({ ...kf, id: nanoid() })
      track.keyframes.sort((a, b) => a.time - b.time)
    }),
  )
}

export function updateKeyframe(
  layerId: string,
  trackId: string,
  keyframeId: string,
  patch: Partial<Omit<Keyframe, 'id'>>,
) {
  setDoc(
    produce((d) => {
      const track = d.layers.find((l) => l.id === layerId)?.tracks.find((t) => t.id === trackId)
      if (!track) return
      const kf = track.keyframes.find((k) => k.id === keyframeId)
      if (!kf) return
      // Store-level guardrails: empty values corrupt exports (literal
      // `opacity:;`), times beyond the duration produce >100% stops that
      // browsers silently drop.
      if (patch.value !== undefined && patch.value.trim() === '') return
      if (patch.time !== undefined && patch.time < 0) return
      Object.assign(kf, patch)
      track.keyframes.sort((a, b) => a.time - b.time)
    }),
  )
}

export function removeKeyframe(layerId: string, trackId: string, keyframeId: string) {
  setDoc(
    produce((d) => {
      const track = d.layers.find((l) => l.id === layerId)?.tracks.find((t) => t.id === trackId)
      if (!track) return
      track.keyframes = track.keyframes.filter((k) => k.id !== keyframeId)
    }),
  )
}

export function setDuration(ms: number) {
  setDoc('duration', ms)
}

export function getSelectedLayer(): Layer | undefined {
  return doc.layers.find((l) => l.id === selectedLayerId())
}

export function getSelectedTrackAndKeyframe(): { track: Track; keyframe: Keyframe } | undefined {
  const kfId = selectedKeyframeId()
  if (!kfId) return undefined
  const layer = getSelectedLayer()
  if (!layer) return undefined
  for (const track of layer.tracks) {
    const kf = track.keyframes.find((k) => k.id === kfId)
    if (kf) return { track, keyframe: kf }
  }
  return undefined
}
