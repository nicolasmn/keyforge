/**
 * Reactive in-memory easing library.
 *
 * localStorage is intentionally NOT used: the app runs in sandboxed iframes
 * where localStorage access is blocked. Uses a plain signal — persistence
 * can be added later via localForage (IndexedDB) in Phase 4.
 */
import { createSignal } from 'solid-js'
import type { EasingPreset } from '@/utils/easing-presets'

const [customEasings, setCustomEasings] = createSignal<EasingPreset[]>([])

export { customEasings }

export function addEasing(name: string, value: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  setCustomEasings((prev) => {
    const exists = prev.some((e) => e.name === trimmed)
    if (exists) return prev.map((e) => (e.name === trimmed ? { name: trimmed, value } : e))
    return [...prev, { name: trimmed, value }]
  })
}

export function removeEasing(name: string): void {
  setCustomEasings((prev) => prev.filter((e) => e.name !== name))
}

export function hasEasing(name: string): boolean {
  return customEasings().some((e) => e.name === name)
}
