// Augment SolidJS JSX namespace so `use:sortable` is a valid JSX attribute.
declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sortable: any
    }
  }
}

export {}
