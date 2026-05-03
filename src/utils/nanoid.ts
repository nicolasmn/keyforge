// Tiny nanoid-like ID generator — no external dependency
// Uses base-36 alphabet (0-9, a-z). Each char encodes 6 bits (0-35).
// We request exactly `len` bytes and map each to one char via modulo 36.
export function nanoid(len = 10): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map((b) => (b % 36).toString(36))
    .join('')
}
