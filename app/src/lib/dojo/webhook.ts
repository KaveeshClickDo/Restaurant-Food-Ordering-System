/**
 * Dojo webhook signature verification. SERVER-SIDE ONLY.
 *
 * Dojo signs every webhook with the `Dojo-Signature` header, computed as
 * HMAC-SHA256 over the RAW request body using your webhook secret, then encoded
 * as "sha256=" + uppercase hex bytes joined by "-". You MUST hash the exact raw
 * body received — do not re-serialize the parsed JSON.
 * See docs/dojo/dojo-integration-reference.md §8.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { dojoConfig } from "./config";

/** Build the signature string for a raw body + secret. */
export function buildDojoSignature(rawBody: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const hex = Array.from(digest).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("-");
  return `sha256=${hex}`;
}

/**
 * Verify a Dojo webhook. Returns false when no secret is configured (mock mode)
 * or the signature is missing/mismatched. Constant-time comparison.
 */
export function verifyDojoSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = dojoConfig().webhookSecret;
  if (!secret || !signatureHeader) return false;
  const expected = buildDojoSignature(rawBody, secret);
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
