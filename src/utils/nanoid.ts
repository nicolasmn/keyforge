// Tiny nanoid-like ID generator, no dependency needed
export function nanoid(len = 10): string {
  return crypto.getRandomValues(new Uint8Array(len)).reduce(
    (acc, b) => acc + (b & 63).toString(36),
    '',
  )
}
