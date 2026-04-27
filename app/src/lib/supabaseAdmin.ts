/**
 * Supabase admin client — uses the service role key.
 * This module MUST only be imported from server-side code (API routes).
 * Never import it from components, context, or any file that runs in the browser.
 *
 * If SUPABASE_SERVICE_ROLE_KEY is not set, every query returns
 * { data: null, error: { message: "..." } } instead of throwing,
 * so route handlers that check `if (error)` return a JSON 500 rather than
 * crashing Next.js into a plain-text "Internal Server Error".
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    if (!serviceRoleKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local — it must never be committed to source control.",
      );
    }
    if (!supabaseUrl) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local.",
      );
    }
    _client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getClient()[prop as keyof SupabaseClient];
  },
});

/**
 * Wraps a Next.js App Router route handler so that any uncaught exception
 * (including Supabase config errors) returns a JSON 500 instead of the
 * default plain-text "Internal Server Error".
 *
 * Usage:
 *   export const GET = withError(async function GET(req) { ... });
 */
type Handler = (...args: unknown[]) => Promise<NextResponse>;

export function withError(fn: Handler): Handler {
  return async (...args: unknown[]): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected server error";
      console.error("[API error]", message);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  };
}
