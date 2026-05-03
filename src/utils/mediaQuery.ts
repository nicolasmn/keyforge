import { createSignal, onCleanup } from 'solid-js'

export function createMediaQuery(query: string) {
  const mq = window.matchMedia(query)
  const [matches, setMatches] = createSignal(mq.matches)
  const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
  mq.addEventListener('change', handler)
  onCleanup(() => mq.removeEventListener('change', handler))
  return matches
}
