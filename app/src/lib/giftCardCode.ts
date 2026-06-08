/**
 * Gift card code generator + normaliser.
 *
 * Format: GC-XXXX-XXXX-XXXX (12 random chars + a "GC-" prefix and dashes
 * for readability). Total ~10¹⁷ possibilities — computationally unguessable.
 *
 * Alphabet: Crockford base32 minus the ambiguous 0/1/I/L/O/U. 29 symbols.
 * No 0/O confusion when read off paper, no I/1 confusion when typed.
 *
 * Codes are stored plaintext. The code IS the entitlement (same as cash) —
 * hashing it would just stop admin from seeing codes for customer support.
 * Brute-forcing the keyspace would take longer than the heat death of the
 * sun; the only realistic attack is leaked-list, which hashing wouldn't help
 * with either (an attacker with DB access already has everything).
 */

import { randomBytes } from "crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // 29 chars, no 0/1/I/L/O/U
const SEGMENT_LEN = 4;
const SEGMENTS = 3;
const PREFIX = "GC";

/** Generate a fresh gift card code. Returns "GC-XXXX-XXXX-XXXX". */
export function generateGiftCardCode(): string {
  // Pull enough random bytes to comfortably index into the alphabet. We need
  // SEGMENT_LEN * SEGMENTS = 12 chars; one byte per char with rejection
  // sampling would be wasteful, but a single 16-byte buffer modulo 29 is
  // statistically fine (the modulo bias is <0.04 bits per char — meaningless
  // for a 12-char code with ~10¹⁷ possibilities).
  const bytes = randomBytes(SEGMENT_LEN * SEGMENTS);
  const chars: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    chars.push(ALPHABET[bytes[i] % ALPHABET.length]);
  }
  const segments: string[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    segments.push(chars.slice(s * SEGMENT_LEN, (s + 1) * SEGMENT_LEN).join(""));
  }
  return `${PREFIX}-${segments.join("-")}`;
}

/**
 * Normalise user-typed input to the canonical form. Accepts any of:
 *   GC-7K9X-LM3P-WT2Q
 *   gc-7k9x-lm3p-wt2q
 *   GC7K9XLM3PWT2Q
 *   "gc 7k9x lm3p wt2q"
 *
 * Strips non-alphanumerics, uppercases, then reinserts dashes. Returns the
 * canonical "GC-XXXX-XXXX-XXXX" form, or null if the input doesn't look
 * like a gift card code at all (so callers can return a friendly 404).
 */
export function normaliseGiftCardCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Expected: PREFIX + 12 alphabet chars = 14 chars.
  if (cleaned.length !== PREFIX.length + SEGMENT_LEN * SEGMENTS) return null;
  if (!cleaned.startsWith(PREFIX)) return null;
  // Re-validate every char is in the alphabet (rejects O/0/I/1/L/U which we
  // intentionally excluded — they're the most common typos).
  const body = cleaned.slice(PREFIX.length);
  for (const ch of body) {
    if (!ALPHABET.includes(ch)) return null;
  }
  const segments: string[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    segments.push(body.slice(s * SEGMENT_LEN, (s + 1) * SEGMENT_LEN));
  }
  return `${PREFIX}-${segments.join("-")}`;
}
