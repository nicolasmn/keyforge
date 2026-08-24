import type { AnimationDocument } from '@/types'
import { nanoid } from '@/utils/nanoid'
import { deserializeDoc, serializeDoc, STORAGE_KEY as LEGACY_DOC_KEY } from './persistence'
import { createSampleDoc } from './sampleDoc'

// ── Projects persistence (localStorage multi-key) ─────────────────────
// Pure functions, no Solid coupling, so they unit-test in node — same
// discipline as persistence.ts. Multi-document storage spreads the single
// autosave across three key families:
//
//   keyforge:projects:index:v1   → ProjectIndex (registry + active id)
//   keyforge:project:<id>:v1     → existing PersistedDoc v1 payload
//                                  (serializeDoc/deserializeDoc UNCHANGED)
//   keyforge:doc:v1              → legacy autosave; read-once migration
//
// All storage access is best-effort try/catch: localStorage may be blocked
// entirely (sandboxed iframes) or full (QuotaExceededError). Persistence
// degrades to a no-op rather than crashing boot or mutations.
//
// Writes follow a write-ahead order — per-project doc BEFORE index, and the
// legacy key is only removed after both writes were attempted — so a partial
// failure leaves the previous good state readable. Multi-tab consistency is
// out of scope for v1 (last-writer-wins, same risk profile as the old
// single-key autosave).

export const PROJECTS_INDEX_KEY = 'keyforge:projects:index:v1'

/** Per-project storage key: `keyforge:project:<id>:v1`. */
export function projectKey(id: string): string {
  return `keyforge:project:${id}:v1`
}

/** Canonical name for the empty first-run project (audit F21). */
export const DEFAULT_PROJECT_NAME = 'Untitled'

/**
 * The built-in sample project's name. Identity-by-name is deliberate for
 * v1 (no `builtin` flag in metadata): deleting it is allowed, and the
 * EmptyState CTA re-registers it via createProjectWithDoc when absent.
 */
export const SAMPLE_PROJECT_NAME = 'Sample animation'

// ── Schema ─────────────────────────────────────────────────────────────

export interface ProjectMeta {
  /** nanoid() from '@/utils/nanoid' — independent of the inner doc's id. */
  id: string
  /** Unique, case-insensitive (see uniqueName). */
  name: string
  createdAt: number
  updatedAt: number
}

export interface ProjectIndex {
  version: 1
  /** Ordered by updatedAt desc (most recent first). */
  projects: ProjectMeta[]
  /** Id of the currently open project. */
  activeId: string
}

/**
 * Returns a valid index, or null when missing/corrupt. Strict on purpose:
 * per §3.6 a corrupt index is treated as absent → fresh seed, which is
 * slightly lossy but bounded.
 */
export function validateIndex(parsed: unknown): ProjectIndex | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Partial<ProjectIndex>
  if (p.version !== 1 || !Array.isArray(p.projects) || typeof p.activeId !== 'string') return null
  const seen = new Set<string>()
  for (const m of p.projects) {
    if (!m || typeof m.id !== 'string' || m.id === '' || seen.has(m.id)) return null
    if (typeof m.name !== 'string') return null
    if (typeof m.createdAt !== 'number' || !Number.isFinite(m.createdAt)) return null
    if (typeof m.updatedAt !== 'number' || !Number.isFinite(m.updatedAt)) return null
    seen.add(m.id)
  }
  // A dangling activeId would strand boot — treat as corrupt instead.
  if (!seen.has(p.activeId)) return null
  return parsed as ProjectIndex
}

/** Most-recent-first ordering invariant for the index + switcher list. */
export function sortByRecency(metas: readonly ProjectMeta[]): ProjectMeta[] {
  return [...metas].sort((a, b) => b.updatedAt - a.updatedAt)
}

// ── Names ──────────────────────────────────────────────────────────────

/**
 * Case-insensitive uniqueness on trim: "foo" collides with "FOO". A taken
 * name auto-suffixes (" 2", " 3", …) instead of nagging with an error modal.
 * Blank input falls back to DEFAULT_PROJECT_NAME ('Untitled').
 */
export function uniqueName(desired: string, existingNames: readonly string[]): string {
  const base = desired.trim() || DEFAULT_PROJECT_NAME
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()))
  let candidate = base
  let n = 2
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} ${n}`
    n += 1
  }
  return candidate
}

// ── Relative timestamps (switcher rows + EmptyState cards) ────────────

/** Compact human age like "just now" / "5m ago" / "2h ago" / "3d ago". */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  try {
    return new Date(timestamp).toLocaleDateString()
  } catch {
    return ''
  }
}

// ── Port seam (Phase B will reimplement over localforage/IndexedDB) ───

/**
 * Narrow sync port over project storage. Phase A is localStorage; the
 * planned IndexedDB swap re-implements this interface without touching
 * callers (store, DocBar, EmptyState).
 */
export interface ProjectsPort {
  readIndex(): ProjectIndex | null
  writeIndex(index: ProjectIndex): void
  readDoc(id: string): AnimationDocument | null
  writeDoc(id: string, doc: AnimationDocument): void
  removeDoc(id: string): void
}

function safeGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    // Blocked storage (SecurityError in sandboxed iframes) → treated absent.
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  } catch (err) {
    // Quota exceeded or blocked — best-effort, warn with the offending key.
    console.warn(`[keyforge] Couldn't persist "${key}" to localStorage`, err)
  }
}

function safeRemove(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export const localStorageProjectsPort: ProjectsPort = {
  readIndex() {
    const raw = safeGet(PROJECTS_INDEX_KEY)
    if (!raw) return null
    try {
      return validateIndex(JSON.parse(raw))
    } catch {
      return null
    }
  },
  writeIndex(index: ProjectIndex) {
    safeSet(PROJECTS_INDEX_KEY, JSON.stringify(index))
  },
  readDoc(id: string) {
    return deserializeDoc(safeGet(projectKey(id)))
  },
  writeDoc(id: string, doc: AnimationDocument) {
    // Reuses the PersistedDoc v1 payload verbatim — JSON import/export
    // round-trips and all existing validation keep working unchanged.
    safeSet(projectKey(id), serializeDoc(doc))
  },
  removeDoc(id: string) {
    safeRemove(projectKey(id))
  },
}

// ── Migration & first-run seeding (idempotent, runs at boot) ──────────

/**
 * One-time legacy autosave migration + index read, per plan §3.2:
 *
 * | State found                    | Action                                        |
 * | ------------------------------ | --------------------------------------------- |
 * | Legacy key + no index          | Migrate: doc → index → remove legacy (W-A order). |
 * | Legacy key AND index           | Migration already ran; drop the stray key.     |
 * | Corrupt legacy payload         | Unrecoverable → seed fresh index.              |
 * | No legacy key, no index        | Fresh install → seed Untitled + Sample.        |
 *
 * Always returns a usable index (never null), so boot can proceed without
 * branching. Safe to call repeatedly.
 */
export function migrateAndReadIndex(port: ProjectsPort = localStorageProjectsPort): ProjectIndex {
  const existing = port.readIndex()
  const legacyRaw = safeGet(LEGACY_DOC_KEY)

  if (existing && legacyRaw) {
    // Index already present → migration ran previously; clean up the stray.
    safeRemove(LEGACY_DOC_KEY)
    return existing
  }
  if (existing) return existing

  if (legacyRaw) {
    const legacyDoc = deserializeDoc(legacyRaw)
    if (legacyDoc) {
      const id = nanoid()
      const now = Date.now()
      const meta: ProjectMeta = {
        id,
        name: uniqueName(legacyDoc.name || DEFAULT_PROJECT_NAME, []),
        createdAt: now,
        updatedAt: now,
      }
      // Write-ahead order: per-project doc → index → delete legacy.
      port.writeDoc(id, legacyDoc)
      port.writeIndex({ version: 1, projects: [meta], activeId: id })
      safeRemove(LEGACY_DOC_KEY)
      return { version: 1, projects: [meta], activeId: id }
    }
    // Corrupt payload — nothing recoverable; drop it and fall through to seed.
    safeRemove(LEGACY_DOC_KEY)
  }

  return seedFreshIndex(port)
}

/**
 * True-first-run seeding creates TWO entries (plan §3.4):
 *  1. "Untitled" — empty doc, ACTIVE, so the guided EmptyState still fires.
 *  2. "Sample animation" — materialized eagerly (~2 KB) and listed in the
 *     switcher/EmptyState cards from the start.
 */
function seedFreshIndex(port: ProjectsPort): ProjectIndex {
  const now = Date.now()
  const untitledId = nanoid()
  const untitledDoc: AnimationDocument = {
    id: nanoid(),
    name: DEFAULT_PROJECT_NAME,
    duration: 2000,
    layers: [],
  }
  // Factory call yields fresh ids, so re-seeding never collides with old ones.
  const sampleDoc = createSampleDoc()
  const sampleId = nanoid()

  // Write-ahead order: docs before the index referencing them.
  port.writeDoc(untitledId, untitledDoc)
  port.writeDoc(sampleId, sampleDoc)

  const index: ProjectIndex = {
    version: 1,
    projects: [
      { id: untitledId, name: untitledDoc.name, createdAt: now, updatedAt: now },
      // −1ms keeps the Untitled-active ordering deterministic across engines
      // whose Array#sort might not be stable.
      { id: sampleId, name: sampleDoc.name, createdAt: now - 1, updatedAt: now - 1 },
    ],
    activeId: untitledId,
  }
  port.writeIndex(index)
  return index
}

// ── Duplication helper ─────────────────────────────────────────────────

/**
 * Deep-copy a document with ALL ids regenerated (doc, layers, tracks,
 * keyframes) — the factory discipline from sampleDoc.ts generalized, so a
 * duplicate can never collide with its source's entities or selection state.
 */
export function cloneDocWithFreshIds(doc: AnimationDocument): AnimationDocument {
  return {
    ...doc,
    id: nanoid(),
    layers: doc.layers.map((layer) => ({
      ...layer,
      id: nanoid(),
      // Deep-copy the element object too (transform-origin plan §1b): origin
      // is MUTABLE structured state, so a shallow share would alias a
      // duplicate's setLayerOrigin back into the source document.
      element: { ...layer.element },
      tracks: layer.tracks.map((track) => ({
        ...track,
        id: nanoid(),
        keyframes: track.keyframes.map((kf) => ({ ...kf, id: nanoid() })),
      })),
    })),
  }
}
