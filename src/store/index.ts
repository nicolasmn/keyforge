import { createStore, produce, reconcile } from 'solid-js/store'
import { createSignal } from 'solid-js'
import type { AnimationDocument, Layer, Track, Keyframe, AnimatableProperty } from '@/types'
import { nanoid } from '@/utils/nanoid'
import {
  serializeDoc,
  deserializeDoc,
  saveToStorage,
  hasOnboarded,
  markOnboarded,
  loadPrefs,
  savePrefs,
} from '@/utils/persistence'
import { createUndoStack } from '@/utils/undoStack'
import {
  DEFAULT_PROJECT_NAME,
  localStorageProjectsPort,
  migrateAndReadIndex,
  cloneDocWithFreshIds,
  sortByRecency,
  uniqueName,
  type ProjectMeta,
} from '@/utils/projects'
import type { SnapIncrement } from '@/utils/snap'
import type { ThemeName } from '@/utils/persistence'
import { interpolatedValueAt } from '@/utils/interpolate'
import { gizmoWritePolicy, inheritEasingForNewKeyframe } from '@/utils/gizmoMath'
import { createStarterBoxLayer } from '@/utils/sampleDoc'
import { isValidOriginComponent } from '@/utils/originMath'

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
 * autosave (now their active project) and gated by the `keyforge:onboarded`
 * flag instead of being shown welcome copy again.
 */
function emptyDefaultDoc(): AnimationDocument {
  return {
    id: nanoid(),
    name: 'Untitled',
    duration: 2000,
    layers: [],
  }
}

// ── Boot: projects registry + active document ────────────────────────
// The doc store remains THE active document — every existing mutation,
// the Preview, Timeline and exports keep working unchanged. Autosave has
// simply learned WHERE to write (the active project's own key), per the
// projects plan §3.3/§3.5. migrateAndReadIndex is idempotent and covers:
//   - legacy single-key autosave → becomes a named project (one-time)
//   - true first run → seeds "Untitled" (active) + "Sample animation"
const port = localStorageProjectsPort
const bootIndex = migrateAndReadIndex(port)

const restoredDoc = port.readDoc(bootIndex.activeId) ?? emptyDefaultDoc()
const [doc, setDocRaw] = createStore<AnimationDocument>(restoredDoc)
export { doc }

/** Reactive registry for the switcher + EmptyState cards (most-recent-first). */
const [projects, setProjects] = createSignal<ProjectMeta[]>(bootIndex.projects)
/** Id of the currently open project — autosave's write address. */
const [activeProjectId, setActiveProjectId] = createSignal<string | null>(bootIndex.activeId)
export const listProjects = projects
export { activeProjectId }

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
// is complete because setDoc is the only write path). Saves target the
// ACTIVE project's key and bump that project's updatedAt (which also
// keeps it at the front of the switcher list).
let saveTimer: ReturnType<typeof setTimeout> | undefined
let savePending = false
const AUTOSAVE_DEBOUNCE_MS = 300

function flushSave() {
  const id = activeProjectId()
  if (!id) {
    // Belt-and-braces: activeProjectId should never be null post-boot, but
    // a botched upgrade must not cost the user their in-memory work.
    saveToStorage(serializeDoc(doc))
  } else {
    port.writeDoc(id, doc)
    // Bump recency + persist index. Doc-before-index order keeps the last
    // good doc readable if quota strikes mid-flush.
    const now = Date.now()
    setProjects(sortByRecency(projects().map((m) => (m.id === id ? { ...m, updatedAt: now } : m))))
    port.writeIndex({ version: 1, projects: projects(), activeId: id })
  }
  savePending = false
}

function scheduleSave() {
  syncOnboardingFlag()
  savePending = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS)
}

/**
 * Drop any pending autosave. Called whenever the store programmatically
 * swaps documents — otherwise a stale timer could resurrect a just-deleted
 * project's key or double-write after an explicit flush.
 */
function cancelPendingSave() {
  clearTimeout(saveTimer)
  saveTimer = undefined
  savePending = false
}

// ── Undo / redo (document history) ─────────────────────────────────────
// Snapshot-based, DOCUMENT-ONLY scope: selection, playhead and which
// project is active are deliberately NOT part of history (agreed design).
//
// The entire mutation surface funnels through setDocWrapped → autosave,
// so that wrapper is the single interception point; replaceDoc (import /
// sample-load / reset) participates too — those are real user actions.
//
// Snapshots are serializeDoc(doc) strings taken BEFORE each committed
// write (serialize reads through the Solid proxy, so it captures the
// pre-mutation state). Restores parse back through deserializeDoc and
// reconcile into the store via the same path as document swaps.
const undoStack = createUndoStack<string>()

/** Reactive flags for the transport-strip buttons + keyboard shortcuts. */
export const canUndo = undoStack.canUndo
export const canRedo = undoStack.canRedo

/**
 * True while a history restoration is being written into the doc store,
 * so commitWithHistory treats it as bookkeeping instead of a new action
 * (an undo must not push an entry onto its own undo stack).
 */
let applyingHistory = false

/**
 * Single interception point shared by setDocWrapped + replaceDoc:
 * capture the pre-write present, apply the mutation, record it as one
 * undo step (bursts inside 300ms coalesce inside the stack itself).
 */
function commitWithHistory(mutate: () => void): void {
  if (applyingHistory) {
    mutate()
    return
  }
  const previousPresent = serializeDoc(doc)
  mutate()
  undoStack.push(previousPresent)
}

/**
 * Restore a snapshot through the same whole-document swap path used by
 * replaceDoc/activateProject. Returns false if the payload failed to
 * validate (defensive — snapshots only ever come from serialized live
 * state, so this should never fire).
 */
function applySnapshot(raw: string): boolean {
  const next = deserializeDoc(raw)
  if (!next) return false
  applyingHistory = true
  try {
    setDocRaw(reconcile(next))
  } finally {
    applyingHistory = false
  }
  return true
}

/**
 * Post-restore reconciliation for everything history does NOT track:
 * drop selections that may reference entities of the previous document
 * generation (selection resets to first layer / null) and keep the
 * playhead inside the restored duration.
 */
function settleAfterHistoryRestore(restored: AnimationDocument): void {
  setSelectedLayerId(restored.layers[0]?.id ?? null)
  setSelectedKeyframeId(null)
  setPlaying(false)
  setPlayhead((p) => Math.min(p, restored.duration))
}

/**
 * Step one snapshot back. Returns false when there is nothing to undo.
 * Restores flow through the normal save path (immediate flush, like any
 * other whole-document swap), so autosaved storage stays consistent.
 */
export function undo(): boolean {
  const target = undoStack.undo(serializeDoc(doc))
  if (target === null) return false
  if (!applySnapshot(target)) return false
  settleAfterHistoryRestore(doc)
  flushSave()
  return true
}

/** Symmetric to undo(): re-apply the most recently undone state. */
export function redo(): boolean {
  const target = undoStack.redo(serializeDoc(doc))
  if (target === null) return false
  if (!applySnapshot(target)) return false
  settleAfterHistoryRestore(doc)
  flushSave()
  return true
}

/**
 * History is per-document: switching projects starts a fresh timeline so
 * snapshots of document A can never be reconciled into document B.
 */
function resetHistory(): void {
  undoStack.clear()
}

/** Replace the whole document (import / reset) and persist now. */
export function replaceDoc(next: AnimationDocument) {
  // Import/sample-load are real user actions → they join undo history.
  commitWithHistory(() => setDocRaw(reconcile(next)))
  syncOnboardingFlag()
  flushSave()
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (savePending) flushSave()
  })
}

/**
 * The single write path for document mutations. Wraps the raw store setter
 * so autosave scheduling AND undo-history capture can't be bypassed by any
 * mutation.
 */
function setDocWrapped(
  updater: AnimationDocument | ((prev: AnimationDocument) => AnimationDocument),
): void
function setDocWrapped<K extends keyof AnimationDocument>(key: K, value: AnimationDocument[K]): void
function setDocWrapped(...args: unknown[]): void {
  commitWithHistory(() => {
    ;(setDocRaw as unknown as (...a: unknown[]) => void)(...args)
  })
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

/** Playback speed multiplier applied by Preview's rAF tick (1 = real time). */
export const [playbackRate, setPlaybackRate] = createSignal(loadPrefs()?.playbackRate ?? 1)

// ── Work area (loop bookends) ───────────────────────────────────────────
/**
 * [start, end] in ms — the region playback loops within when loop is on.
 * Defaults cover the whole document; clamped to [0, duration] with
 * start < end on every write. Session state (rides in prefs, not the doc).
 */
const _prefsWa = loadPrefs()?.workArea
export const [workAreaStart, setWorkAreaStart] = createSignal(_prefsWa?.start ?? 0)
export const [workAreaEnd, setWorkAreaEnd] = createSignal(_prefsWa?.end ?? Number.POSITIVE_INFINITY)

/** Clamp-and-write both bookends; keeps start < end (min 50ms span). */
export function setWorkArea(start: number, end: number): void {
  const dur = doc.duration
  const s = Math.max(0, Math.min(start, dur - 50))
  const e = Math.max(s + 50, Math.min(end, dur))
  setWorkAreaStart(s)
  setWorkAreaEnd(e)
}

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

// ── Projects API ───────────────────────────────────────────────────────
// Multi-document management (plan §3.3). The doc store stays the single
// active document; these functions swap which document it holds and keep
// the index + per-project keys consistent.

/**
 * Reset transient editor state that may point at entities of a document
 * that no longer exists. Centralizes what loadSample/importFile used to
 * duplicate; callers decide playback themselves.
 */
export function resetTransientState() {
  setSelectedLayerId(doc.layers[0]?.id ?? null)
  setSelectedKeyframeId(null)
  setPlayhead(0)
  setPlaying(false)
}

/** Cheap readability probe for switcher UIs (grey out unrecoverable rows). */
export function isProjectReadable(id: string): boolean {
  return port.readDoc(id) !== null
}

/**
 * Point the app at project `id`. Assumes the caller already read + flushed;
 * never flushes here so it is safe for delete-fall-over (the outgoing doc
 * must not be written back).
 */
function activateProject(id: string, next: AnimationDocument) {
  cancelPendingSave()
  setDocRaw(reconcile(next))
  setActiveProjectId(id)
  setProjects(sortByRecency(projects()))
  port.writeIndex({ version: 1, projects: projects(), activeId: id })
  syncOnboardingFlag()
  resetHistory() // snapshots of the outgoing document must not leak across
  resetTransientState()
}

/**
 * Open another project, flush-saving the current one first. Missing or
 * corrupt targets keep the current document untouched (no data loss).
 * Returns false when the target could not be opened.
 */
export function openProject(id: string): boolean {
  if (id === activeProjectId()) return true
  if (!projects().some((m) => m.id === id)) return false
  flushSave() // persist the outgoing project before leaving it
  const next = port.readDoc(id)
  if (!next) return false
  activateProject(id, next)
  return true
}

/** Prepend a freshly-stamped meta (most-recent-first invariant). */
function insertMeta(id: string, name: string): void {
  const now = Date.now()
  setProjects([{ id, name, createdAt: now, updatedAt: now }, ...projects()])
}

/** Shared tail of createProject/createProjectWithDoc/duplicateProject. */
function openFreshProject(id: string, fresh: AnimationDocument) {
  port.writeDoc(id, fresh) // write-ahead: doc lands before the index referencing it
  insertMeta(id, fresh.name)
  activateProject(id, fresh)
}

/**
 * Create an empty named project and open it. Names are unique — a collision
 * auto-suffixes ("Untitled 2") instead of erroring (plan §3.6).
 */
export function createProject(name?: string): string {
  const finalName = uniqueName(
    name?.trim() || DEFAULT_PROJECT_NAME,
    projects().map((m) => m.name),
  )
  flushSave()
  const id = nanoid()
  const fresh: AnimationDocument = {
    id: nanoid(),
    name: finalName,
    duration: 2000,
    layers: [],
  }
  openFreshProject(id, fresh)
  return id
}

/**
 * Create a project seeded by a preset factory and open it — how the built-in
 * sample re-registers itself after deletion (plan §3.4). The factory runs on
 * every call so ids are always fresh.
 */
export function createProjectWithDoc(name: string, makeDoc: () => AnimationDocument): string {
  const finalName = uniqueName(
    name,
    projects().map((m) => m.name),
  )
  flushSave()
  const created = makeDoc()
  created.name = finalName
  const id = nanoid()
  openFreshProject(id, created)
  return id
}

/**
 * Rename in the registry AND (for the active project) the live document, so
 * DocBar and exports can never diverge from the index. DocBar's inline rename
 * routes through this instead of raw setDoc('name').
 * Returns the committed (uniquified) name.
 */
export function renameProject(id: string, name: string): string {
  const others = projects()
    .filter((m) => m.id !== id)
    .map((m) => m.name)
  const finalName = uniqueName(name.trim() || DEFAULT_PROJECT_NAME, others)
  setProjects((prev) => prev.map((m) => (m.id === id ? { ...m, name: finalName } : m)))
  if (id === activeProjectId()) {
    // Keep the persisted payload in lockstep with the index immediately.
    setDocRaw('name', finalName)
    flushSave()
  } else {
    port.writeIndex({ version: 1, projects: projects(), activeId: activeProjectId()! })
  }
  return finalName
}

/**
 * Remove a project permanently. Deleting the ACTIVE one falls over to the
 * next most-recent readable project — or auto-creates Untitled when none
 * remain — so the app is never left without an active document. Unreadable
 * metas stay listed (UI greys them out) for manual cleanup.
 */
export function deleteProject(id: string): void {
  const wasActive = id === activeProjectId()
  port.removeDoc(id)
  const remaining = sortByRecency(projects().filter((m) => m.id !== id))
  setProjects(remaining)
  if (!wasActive) {
    port.writeIndex({ version: 1, projects: remaining, activeId: activeProjectId()! })
    return
  }
  // Never let a pending autosave resurrect the just-deleted key…
  cancelPendingSave()
  // …and fall over to the next most-recent READABLE project, if any.
  for (const meta of remaining) {
    const next = port.readDoc(meta.id)
    if (next) {
      activateProject(meta.id, next)
      return
    }
  }
  // Nothing usable left — auto-create Untitled. Deliberately NOT the public
  // createProject(): that flush-saves first, which would write `doc` (still
  // holding the just-deleted project) into its now-removed key.
  const finalName = uniqueName(
    DEFAULT_PROJECT_NAME,
    projects().map((m) => m.name),
  )
  const fresh: AnimationDocument = { id: nanoid(), name: finalName, duration: 2000, layers: [] }
  const newId = nanoid()
  port.writeDoc(newId, fresh)
  insertMeta(newId, finalName)
  activateProject(newId, fresh)
}

/**
 * Deep-copy a project with all-fresh ids under "<name> copy" and open it.
 * Returns the new project id, or null when the source is unreadable.
 */
export function duplicateProject(id: string): string | null {
  const meta = projects().find((m) => m.id === id)
  if (!meta) return null
  flushSave() // capture unsaved active-project edits before copying
  const source = port.readDoc(id)
  if (!source) return null
  const finalName = uniqueName(
    `${meta.name} copy`,
    projects().map((m) => m.name),
  )
  const copy = cloneDocWithFreshIds(source)
  copy.name = finalName
  const newId = nanoid()
  openFreshProject(newId, copy)
  return newId
}

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

// ── Transform-origin debug view ────────────────────────────────────────
/**
 * Stage markers (crosshairs + ghost outlines) visualizing each layer's
 * transform-origin. Additive pref like snap/theme: absent in older blobs →
 * false. While pick mode is active the overlay renders regardless.
 */
const [showOriginsState, setShowOriginsState] = createSignal<boolean>(
  loadPrefs()?.showOrigins === true,
)
export const showOrigins = showOriginsState

/** Flip marker visibility on the stage and persist it additively. */
export function setShowOrigins(next: boolean) {
  setShowOriginsState(next)
  savePrefs({ version: 1, snapIncrement: snapIncrement(), theme: theme(), showOrigins: next })
}

// ── Stage Live-Editing (transform gizmos plan Revision 1 §A) ───────────
/**
 * When ON, every visible layer draws its POSED outline on the stage and the
 * selected layer additionally shows handles + stem — independent of hover,
 * so gizmo affordances stay visible while scrubbing/playing. When OFF the
 * Phase-1 hover-gated behavior applies (nothing at rest; an active gesture
 * still pins its overlay until pointerup/Esc). Additive pref exactly like
 * `showOrigins`: absent/garbage in persisted blobs → false.
 */
const [liveEditState, setLiveEditState] = createSignal<boolean>(loadPrefs()?.liveEdit === true)
export const liveEdit = liveEditState

/** Flip Live-Editing on the stage and persist it additively. */
export function setLiveEdit(next: boolean) {
  setLiveEditState(next)
  savePrefs({ version: 1, snapIncrement: snapIncrement(), theme: theme(), liveEdit: next })
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

// ── Transform-origin mutations ─────────────────────────────────────────
/**
 * Static transform-origin for a layer's element (structured field on
 * LayerElement, never mirrored into initialCss). Components are validated
 * at write time against ORIGIN_COMPONENT_RE and stored verbatim (trimmed);
 * invalid input is a no-op — the UI reverts instead. Unknown layer ids are
 * no-ops. Once set, an explicit `50% 50%` stays (WYSIWYG: marker + exported
 * decl remain visible even at the CSS-default position).
 */
export function setLayerOrigin(layerId: string, x: string, y: string) {
  const nx = x.trim()
  const ny = y.trim()
  if (!isValidOriginComponent(nx) || !isValidOriginComponent(ny)) return
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (!layer) return
      layer.element.origin = { x: nx, y: ny }
    }),
  )
}

/**
 * Remove the structured origin entirely so persisted JSON stays clean
 * (absent key = "user never touched it", not "explicitly centered").
 */
export function clearLayerOrigin(layerId: string) {
  setDoc(
    produce((d) => {
      const layer = d.layers.find((l) => l.id === layerId)
      if (layer && layer.element.origin !== undefined) delete layer.element.origin
    }),
  )
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

/**
 * Add a keyframe to a track. Returns the new keyframe's id, or null when the
 * layer/track vanished mid-call (callers that need the id — e.g. gizmo
 * gesture bookkeeping for Esc-cancel reversal — rely on this).
 */
export function addKeyframe(
  layerId: string,
  trackId: string,
  kf: Omit<Keyframe, 'id'>,
): string | null {
  const id = nanoid()
  let created: string | null = null
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
      track.keyframes.push({ ...kf, id })
      track.keyframes.sort((a, b) => a.time - b.time)
      created = id
    }),
  )
  // The assignment happens inside produce's callback; TS can't see through
  // setDoc, so re-widen past its initializer-based null narrowing.
  return created as string | null
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

// ── Stage gizmo writes (transform gizmos plan §2/§4) ───────────────────
/**
 * What one gizmo gesture frame actually wrote — the overlay collects these
 * so Esc can reverse the gesture structurally (restore overwritten values,
 * remove created keyframes/tracks in reverse order) instead of relying on
 * the undo stack's 300ms burst window.
 */
export interface GizmoEditReceipt {
  kind: 'update-kf' | 'create-kf' | 'create-track-and-kf'
  trackId: string
  /** Present for update-kf / create-kf. */
  kfId?: string
  /** Pre-write value of an updated keyframe (for cancel restoration). */
  originalValue?: string
}

/**
 * Auto-key write path for stage gizmos: land `newValue` for `property` at
 * the playhead, deciding WHERE purely via gizmoWritePolicy —
 *
 *   playhead on an existing keyframe (±8ms) → rewrite that keyframe's value
 *   track exists between/outside keys       → insert a keyframe at playhead
 *   no track yet                            → create track + first keyframe
 *
 * New keyframes inherit the leaving neighbor's easing ('ease-out' when none,
 * matching "+ KF" capture). Everything funnels through setDoc, so autosave
 * and the 300ms-burst undo coalescing treat a whole drag as one entry.
 * Returns a receipt for gesture cancel bookkeeping (null = nothing written).
 */
export function applyGizmoEdit(
  layerId: string,
  property: AnimatableProperty,
  playheadMs: number,
  newValue: string,
): GizmoEditReceipt | null {
  const layer = doc.layers.find((l) => l.id === layerId)
  if (!layer || newValue.trim() === '') return null
  // Defensive clamp: stops beyond 100% are silently dropped by browsers.
  const time = Math.max(0, Math.min(doc.duration, playheadMs))
  const existing = layer.tracks.find((t) => t.property === property) ?? null

  const plan = gizmoWritePolicy(existing, time)
  if (plan.kind === 'update-kf' && existing) {
    const kf = existing.keyframes.find((k) => k.id === plan.kfId)
    if (!kf) return null
    const originalValue = kf.value
    updateKeyframe(layerId, existing.id, plan.kfId, { value: newValue })
    return { kind: 'update-kf', trackId: existing.id, kfId: kf.id, originalValue }
  }

  if (plan.kind === 'create-kf' && existing) {
    const sorted = [...existing.keyframes].sort((a, b) => a.time - b.time)
    const easing = inheritEasingForNewKeyframe(sorted, time)
    const kfId = addKeyframe(layerId, existing.id, { time, value: newValue, easing })
    if (!kfId) return null
    return { kind: 'create-kf', trackId: existing.id, kfId }
  }

  // No individual track yet — auto-key creates it. A brand-new track has no
  // neighbors to inherit from, so the first keyframe uses the default easing.
  const trackId = addTrack(layerId, property)
  if (!trackId) return null
  const kfId = addKeyframe(layerId, trackId, { time, value: newValue, easing: 'ease-out' })
  if (!kfId) return null
  return { kind: 'create-track-and-kf', trackId, kfId }
}

/**
 * Deep-copy a layer (fresh ids for layer/tracks/keyframes) named "<name> copy",
 * inserted directly after the source, and select the copy. Returns the new id.
 */
export function duplicateLayer(layerId: string): string | null {
  const source = doc.layers.find((l) => l.id === layerId)
  if (!source) return null
  const copy: Layer = JSON.parse(JSON.stringify(source))
  copy.id = nanoid()
  // Slug-parity guard (#104): two layers named "Box copy" would emit
  // identical [data-layer-id] selectors and @keyframes names — last one
  // wins for BOTH copies. Uniquify against current layer names.
  copy.name = uniqueName(
    `${source.name} copy`,
    doc.layers.map((l) => l.name),
  )
  copy.collapsed = false
  for (const t of copy.tracks) {
    t.id = nanoid()
    for (const k of t.keyframes) k.id = nanoid()
  }
  setDoc(
    produce((d) => {
      const idx = d.layers.findIndex((l) => l.id === layerId)
      d.layers.splice(idx + 1, 0, copy)
    }),
  )
  setSelectedLayerId(copy.id)
  return copy.id
}

/**
 * Clone one keyframe with a fresh id at `atTime` (default: +50ms clamped into
 * the duration), keeping value and easing; selects the clone. Returns its id.
 */
export function duplicateKeyframe(
  layerId: string,
  trackId: string,
  kfId: string,
  atTime?: number,
): string | null {
  const track = doc.layers.find((l) => l.id === layerId)?.tracks.find((t) => t.id === trackId)
  const source = track?.keyframes.find((k) => k.id === kfId)
  if (!track || !source) return null
  const fallbackTime = Math.min(source.time + 50, doc.duration)
  const time = Math.max(0, Math.min(Math.round(atTime ?? fallbackTime), doc.duration))
  const copy: Keyframe = { id: nanoid(), time, value: source.value, easing: source.easing }
  setDoc(
    produce((d) => {
      const t2 = d.layers.find((l) => l.id === layerId)?.tracks.find((t) => t.id === trackId)
      if (!t2) return
      t2.keyframes.push(copy)
      t2.keyframes.sort((a, b) => a.time - b.time)
    }),
  )
  setSelectedKeyframeId(copy.id)
  return copy.id
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
