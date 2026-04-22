import { customAlphabet } from "nanoid";

// 12-char URL-safe slugs. Alphabet excludes look-alikes (0/O, 1/l/I) so
// slugs are easier to copy from one device to another.
// Entropy: 57^12 ≈ 10^21 — effectively unguessable.
const alphabet =
  "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";

const nano = customAlphabet(alphabet, 12);

export function newSlug(): string {
  return nano();
}

/** Sanity-check a slug shape before hitting storage. Does NOT prove the
 *  slug exists — just that it's a plausibly-formed one and not a traversal
 *  attempt. */
export function isValidSlug(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9]{12}$/.test(s);
}
