// Augment SolidJS JSX namespace so `use:sortable` is a valid attribute.
// Required because TypeScript doesn't know about Solid directives by default.
import type { Accessor } from 'solid-js'
import type { SortableReturn } from '@thisbeyond/solid-dnd'

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      sortable: SortableReturn
    }
  }
}

export {}
