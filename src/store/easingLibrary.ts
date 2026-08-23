/**
 * Reactive in-memory easing library.
 *
 * Uses @solid-primitives/storage makeObjectStorage so the API matches
 * a real Storage and can be swapped for localForage (IndexedDB) in Phase 4
 * by changing the `storage` option — zero other changes needed.
 *
 * localStorage is intentionally NOT used: the app runs in sandboxed iframes
 * where localStorage access is blocked.
 */
import { createSignal } from 'solid-js'
import { makePersisted, makeObjectStorage } from '@solid-primitives/storage'
import type { EasingPreset } from '@/utils/easing-presets'

const _backingStore: Record<string, string> = {}

// Array destructuring is intentional: makePersisted's union return type
// (array | object form) prevents solid/reactivity from proving the array
// form, so the rule flags a legitimate destructure.
/* eslint-disable solid/reactivity */
const [customEasings, setCustomEasings] = makePersisted(createSignal<EasingPreset[]>([]), {
  name: 'keyforge-easing-library',
  storage: makeObjectStorage(_backingStore),
})
/* eslint-enable solid/reactivity */

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
