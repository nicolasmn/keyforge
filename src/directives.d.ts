// Augment SolidJS JSX namespace so `use:sortable` is a valid attribute on any element.
import type { createSortable } from '@thisbeyond/solid-dnd'

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      sortable: ReturnType<typeof createSortable>
    }
  }
}

export {}
