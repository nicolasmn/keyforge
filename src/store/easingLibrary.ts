/**
 * Reactive easing library with localStorage persistence.
 *
 * localStorage works when the app runs standalone (not in a sandboxed
 * iframe). When it's blocked (sandbox), we silently fall back to an
 * in-memory signal — entries persist for the session but not across
 * reloads.
 */
import { createSignal } from 'solid-js'
import type { EasingPreset } from '@/utils/easing-presets'

const STORAGE_KEY = 'keyforge-easing-library'

function loadFromStorage(): EasingPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is EasingPreset =>
        typeof e === 'object' &&
        e !== null &&
        typeof e.name === 'string' &&
        typeof e.value === 'string',
    )
  } catch {
    return []
  }
}

function saveToStorage(entries: EasingPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage blocked (sandboxed iframe) — in-memory only
  }
}

const [customEasings, setCustomEasings] = createSignal<EasingPreset[]>(loadFromStorage())

export { customEasings }

export function addEasing(name: string, value: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  setCustomEasings((prev) => {
    const exists = prev.some((e) => e.name === trimmed)
    const next = exists
      ? prev.map((e) => (e.name === trimmed ? { name: trimmed, value } : e))
      : [...prev, { name: trimmed, value }]
    saveToStorage(next)
    return next
  })
}

export function removeEasing(name: string): void {
  setCustomEasings((prev) => {
    const next = prev.filter((e) => e.name !== name)
    saveToStorage(next)
    return next
  })
}

export function hasEasing(name: string): boolean {
  return customEasings().some((e) => e.name === name)
}
