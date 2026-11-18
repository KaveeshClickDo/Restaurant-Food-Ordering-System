/**
 * The favicon uploaded in Admin → SEO is stored as a data URL
 * ("data:image/png;base64,…"). Decode it so /favicon.ico can serve the image
 * itself. Returns null for anything that isn't an image data URL, so the
 * caller falls back to the default icon.
 */
export function decodeImageDataUrl(url: string): { type: string; body: Buffer } | null {
  const m = url.trim().match(/^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i);
  if (!m) return null;
  const [, type, base64, payload] = m;
  try {
    const body = base64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
    return body.length ? { type: type.toLowerCase(), body } : null;
  } catch {
    return null;
  }
}
