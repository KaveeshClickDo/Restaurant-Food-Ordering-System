/**
 * GET /api/favicon, served at /favicon.ico through a rewrite in next.config.ts.
 *
 * Browsers, bookmarks and search engines request /favicon.ico on their own,
 * without reading the page's <link rel="icon">. Serve the favicon uploaded in
 * Admin → SEO, or the built-in default when none is set.
 *
 * Not a static app/favicon.ico: Next.js turns that file into a second
 * <link rel="icon"> that competes with the uploaded one (see layout.tsx), and
 * a folder of that name is reserved for the same file convention.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDbSettings } from "@/lib/dbSettings";
import { decodeImageDataUrl } from "@/lib/favicon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE = "public, max-age=300";

export async function GET() {
  const data = await getDbSettings();
  const uploaded = ((data?.seo as { faviconUrl?: string } | undefined)?.faviconUrl ?? "").trim();

  const image = decodeImageDataUrl(uploaded);
  if (image) {
    return new Response(new Uint8Array(image.body), { headers: { "Content-Type": image.type, "Cache-Control": CACHE } });
  }
  if (/^https?:\/\//i.test(uploaded)) {
    return Response.redirect(uploaded, 307);
  }

  try {
    const body = await readFile(join(process.cwd(), "public", "favicon-default.ico"));
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "image/x-icon", "Cache-Control": CACHE } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
