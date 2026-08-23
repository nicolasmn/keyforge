import type { AnimationDocument } from '@/types'

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
